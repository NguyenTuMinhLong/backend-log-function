'use strict';

/*
=========================================================
REFUND SERVICE - Business Logic
=========================================================
*/

const pool = require('../config/db');
const QR = require('../queries/refund.queries');
const QB = require('../queries/booking.queries');
const QP = require('../queries/payment.queries');
const {
  POLICIES,
  ADMIN_FEE,
  VOUCHER_HANDLING,
  VALIDATION,
  CONCURRENCY,
  findPolicy,
  hoursBeforeDeparture,
} = require('../config/refund.config');
const { revokePointsForRefund } = require('./loyalty.service');
const { createRefundNotification } = require('./notification.service');

// =========================================================
// HELPERS
// =========================================================

const generateRefundCode = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `REF-${date}-${suffix}`;
};

const calculateHoursUntilDeparture = (departureTime) => {
  const now = new Date();
  const departure = new Date(departureTime);
  const diffMs = departure - now;
  return diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
};

const validateRefundRequest = (booking, payment, userId) => {
  // 1. Booking phải tồn tại
  if (!booking) throw new Error('Không tìm thấy booking');

  // 2. Booking phải là confirmed (đã thanh toán)
  if (booking.status !== 'confirmed') {
    throw new Error(`Không thể refund booking có trạng thái "${booking.status}". Chỉ booking đã thanh toán mới được refund.`);
  }

  // 3. Kiểm tra flight chưa khởi hành
  if (new Date(booking.outbound_departure_time) <= new Date()) {
    throw new Error('Không thể refund: Chuyến bay đã khởi hành');
  }

  // 4. Nếu là round trip, kiểm tra cả chuyến về
  if (booking.trip_type === 'round_trip' && booking.return_departure_time) {
    if (new Date(booking.return_departure_time) <= new Date()) {
      throw new Error('Không thể refund: Chuyến bay về đã khởi hành');
    }
  }

  // 5. Kiểm tra payment tồn tại
  if (!payment) throw new Error('Không tìm thấy thông tin thanh toán');

  // 6. Payment phải là success
  if (payment.status !== 'SUCCESS') {
    throw new Error('Chỉ booking đã thanh toán thành công mới được refund');
  }

  // 7. Check duplicate request (race condition protection)
  if (CONCURRENCY.preventDuplicateRequests) {
    // Sẽ check trong transaction để tránh race condition
  }
};

// =========================================================
// CALCULATE REFUND AMOUNT
// =========================================================

const calculateRefundAmount = (booking, payment, policy, refundType = 'full', requestedItems = null) => {
  // Xác định base amount để tính refund
  let baseAmount;
  if (VOUCHER_HANDLING.refundOnFinalAmount) {
    // Refund trên số tiền đã trả thực tế (final_amount)
    baseAmount = parseFloat(payment.final_amount || payment.amount);
  } else {
    // Refund trên tổng giá trị booking
    baseAmount = parseFloat(payment.amount);
  }

  let refundPercent = policy.refundPercent;
  let refundAmount;

  switch (refundType) {
    case 'full':
      refundAmount = baseAmount * (refundPercent / 100);
      break;

    case 'partial_leg':
      // Hoàn 1 leg (outbound hoặc return)
      const isOutboundOnly = requestedItems?.legs?.includes('outbound') && !requestedItems?.legs?.includes('return');
      const isReturnOnly = requestedItems?.legs?.includes('return') && !requestedItems?.legs?.includes('outbound');

      if (isOutboundOnly || isReturnOnly) {
        // Tính 50% của base amount cho 1 leg
        refundAmount = (baseAmount / 2) * (refundPercent / 100);
      } else {
        // Cả 2 leg
        refundAmount = baseAmount * (refundPercent / 100);
      }
      break;

    case 'partial_passenger':
      // Hoàn theo số passenger
      const totalPassengers = parseInt(booking.total_adults) + parseInt(booking.total_children) + parseInt(booking.total_infants);
      const requestedPassengers = requestedItems?.passenger_ids?.length || totalPassengers;
      refundAmount = (baseAmount * (requestedPassengers / totalPassengers)) * (refundPercent / 100);
      break;

    default:
      refundAmount = baseAmount * (refundPercent / 100);
  }

  // Tính admin fee
  let adminFee = 0;
  if (ADMIN_FEE.enabled) {
    const isExempt = ADMIN_FEE.exemptStatuses?.includes(policy.name);
    if (!isExempt && refundPercent > 0) {
      adminFee = Math.min(
        Math.max(refundAmount * (ADMIN_FEE.percent / 100), ADMIN_FEE.minAmount),
        ADMIN_FEE.maxAmount
      );
    }
  }

  const netRefundAmount = Math.max(0, refundAmount - adminFee);

  return {
    original_amount: parseFloat(payment.amount),
    discount_amount: parseFloat(payment.discount_amount || 0),
    base_amount: baseAmount,
    refund_percent: refundPercent,
    refund_amount: Math.round(refundAmount),
    admin_fee: Math.round(adminFee),
    net_refund_amount: Math.round(netRefundAmount),
    policy: {
      name: policy.name,
      label: policy.label,
      hours_before: policy.hoursBefore,
    },
  };
};

// =========================================================
// REQUEST REFUND (USER)
// =========================================================

const requestRefund = async (userId, bookingCode, data) => {
  const {
    refund_type = 'full',
    requested_items = null,
    reason,
    user_notes = null,
  } = data;

  // Validate required fields
  if (VALIDATION.requireReason) {
    if (!reason || reason.trim().length < VALIDATION.minReasonLength) {
      throw new Error(`Lý do yêu cầu refund phải có ít nhất ${VALIDATION.minReasonLength} ký tự`);
    }
  }

  // Validate refund type
  if (!['full', 'partial_leg', 'partial_passenger'].includes(refund_type)) {
    throw new Error('refund_type phải là: full, partial_leg, hoặc partial_passenger');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get booking info
    const bookingResult = await client.query(QB.SELECT_BOOKING_DETAIL, [bookingCode]);
    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const booking = bookingResult.rows[0];

    // 2. Check ownership (user có quyền refund booking của mình)
    if (userId && booking.user_id && booking.user_id !== userId) {
      throw new Error('Bạn không có quyền thực hiện yêu cầu này');
    }

    // 3. Get payment info
    const paymentResult = await client.query(QP.SELECT_PAYMENT_BY_BOOKING, [booking.id]);
    if (paymentResult.rows.length === 0) throw new Error('Không tìm thấy thông tin thanh toán');

    const payment = paymentResult.rows[0];

    // 4. Validate refund request
    validateRefundRequest(booking, payment, userId);

    // 5. Check duplicate request (với lock để tránh race condition)
    const existingRefund = await client.query(QR.CHECK_PENDING_REFUND_FOR_BOOKING, [booking.id]);
    if (existingRefund.rows.length > 0) {
      throw new Error('Đã có yêu cầu refund đang chờ xử lý cho booking này');
    }

    // 6. Calculate hours until departure & find policy
    const hoursLeft = calculateHoursUntilDeparture(booking.outbound_departure_time);
    const policy = findPolicy(hoursLeft);

    // 7. Check policy allows refund
    if (policy.refundPercent === 0) {
      throw new Error(`Không thể refund: Yêu cầu phải được gửi trước ${POLICIES[0].hoursBefore} tiếng trước giờ khởi hành`);
    }

    // 8. Calculate refund amount
    const refundCalc = calculateRefundAmount(booking, payment, policy, refund_type, requested_items);

    // 9. Check minimum refund amount
    if (refundCalc.net_refund_amount < VALIDATION.minRefundAmount) {
      throw new Error(`Số tiền hoàn (${refundCalc.net_refund_amount}) không đủ để xử lý`);
    }

    // 10. Generate refund code
    let refundCode;
    let isUnique = false;
    while (!isUnique) {
      refundCode = generateRefundCode();
      const check = await client.query(QR.CHECK_REFUND_EXISTS_BY_CODE, [refundCode]);
      if (check.rows.length === 0) isUnique = true;
    }

    // 11. Create refund request
    const refundResult = await client.query(QR.INSERT_REFUND, [
      refundCode,
      booking.id,
      payment.id,
      refund_type,
      requested_items ? JSON.stringify(requested_items) : null,
      refundCalc.refund_amount,
      refundCalc.admin_fee,
      refundCalc.net_refund_amount,
      JSON.stringify(refundCalc.policy),
      'pending',
      reason,
      user_notes,
      userId,
    ]);

    const refund = refundResult.rows[0];

    // 12. Update booking status to refund_pending
    await client.query(QB.UPDATE_BOOKING_STATUS, ['refund_pending', booking.id]);

    // 13. Send notification
    try {
      await createRefundNotification({
        event: 'REFUND_REQUESTED',
        refund,
        booking,
        userId,
      });
    } catch (notifErr) {
      console.error('[Refund] Notification error:', notifErr.message);
      // Không throw để không ảnh hưởng đến refund request
    }

    await client.query('COMMIT');

    return {
      success: true,
      refund_code: refund.refund_code,
      status: refund.status,
      refund_type,
      refund_preview: {
        refund_amount: refundCalc.refund_amount,
        admin_fee: refundCalc.admin_fee,
        net_refund_amount: refundCalc.net_refund_amount,
        policy_applied: refundCalc.policy,
      },
      message: `Yêu cầu hoàn tiền đã được tiếp nhận. Mã yêu cầu: ${refund.refund_code}`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// GET REFUND DETAIL
// =========================================================

const getRefundDetail = async (refundCode) => {
  const result = await pool.query(QR.SELECT_REFUND_BY_CODE, [refundCode]);
  if (result.rows.length === 0) throw new Error('Không tìm thấy yêu cầu hoàn tiền');

  const refund = result.rows[0];

  // Get passengers affected
  const passengersResult = await pool.query(
    'SELECT id, full_name, passenger_type, flight_type FROM passengers WHERE booking_id = $1',
    [refund.booking_id]
  );

  return {
    ...refund,
    passengers: refund.requested_items?.passenger_ids
      ? passengersResult.rows.filter(p => refund.requested_items.passenger_ids.includes(p.id))
      : passengersResult.rows,
  };
};

// =========================================================
// GET USER REFUNDS
// =========================================================

const getUserRefunds = async (userId, page = 1, limit = 10) => {
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const [dataResult, countResult] = await Promise.all([
    pool.query(QR.SELECT_USER_REFUNDS, [userId, parseInt(limit), offset]),
    pool.query(QR.COUNT_USER_REFUNDS, [userId]),
  ]);

  const total = parseInt(countResult.rows[0].count);

  return {
    data: dataResult.rows,
    pagination: {
      total,
      page: parseInt(page),
      limit: parseInt(limit),
      total_pages: Math.ceil(total / parseInt(limit)),
    },
  };
};

// =========================================================
// APPROVE REFUND (ADMIN)
// =========================================================

const approveRefund = async (adminId, refundCode, adminNotes = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get refund info
    const refundResult = await client.query(QR.SELECT_REFUND_BY_CODE, [refundCode]);
    if (refundResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu hoàn tiền');

    const refund = refundResult.rows[0];

    // 2. Validate status
    if (refund.status !== 'pending') {
      throw new Error(`Không thể duyệt yêu cầu có trạng thái "${refund.status}"`);
    }

    // 3. Update refund status
    await client.query(QR.UPDATE_REFUND_STATUS, [
      'approved',
      adminId,
      adminNotes,
      refundCode,
    ]);

    // 4. Send notification
    try {
      await createRefundNotification({
        event: 'REFUND_APPROVED',
        refund: { ...refund, status: 'approved', admin_notes: adminNotes },
        adminId,
      });
    } catch (notifErr) {
      console.error('[Refund] Notification error:', notifErr.message);
    }

    await client.query('COMMIT');

    return {
      success: true,
      refund_code: refundCode,
      status: 'approved',
      message: 'Yêu cầu hoàn tiền đã được duyệt',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// REJECT REFUND (ADMIN)
// =========================================================

const rejectRefund = async (adminId, refundCode, reason) => {
  if (!reason || reason.trim().length < 10) {
    throw new Error('Vui lòng nhập lý do từ chối (ít nhất 10 ký tự)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get refund info
    const refundResult = await client.query(QR.SELECT_REFUND_BY_CODE, [refundCode]);
    if (refundResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu hoàn tiền');

    const refund = refundResult.rows[0];

    // 2. Validate status
    if (refund.status !== 'pending') {
      throw new Error(`Không thể từ chối yêu cầu có trạng thái "${refund.status}"`);
    }

    // 3. Update refund status
    await client.query(QR.UPDATE_REFUND_STATUS, [
      'rejected',
      adminId,
      reason,
      refundCode,
    ]);

    // 4. Revert booking status back to confirmed
    await client.query(QB.UPDATE_BOOKING_STATUS, ['confirmed', refund.booking_id]);

    // 5. Send notification
    try {
      await createRefundNotification({
        event: 'REFUND_REJECTED',
        refund: { ...refund, status: 'rejected', admin_notes: reason },
        adminId,
      });
    } catch (notifErr) {
      console.error('[Refund] Notification error:', notifErr.message);
    }

    await client.query('COMMIT');

    return {
      success: true,
      refund_code: refundCode,
      status: 'rejected',
      message: 'Yêu cầu hoàn tiền đã bị từ chối',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// PROCESS REFUND (ADMIN) - Gọi payment gateway để hoàn tiền
// =========================================================

const processRefund = async (adminId, refundCode) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get refund info
    const refundResult = await client.query(QR.SELECT_REFUND_BY_CODE, [refundCode]);
    if (refundResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu hoàn tiền');

    const refund = refundResult.rows[0];

    // 2. Validate status (phải là approved mới process được)
    if (refund.status !== 'approved') {
      throw new Error(`Không thể xử lý yêu cầu có trạng thái "${refund.status}". Phải duyệt yêu cầu trước.`);
    }

    // 3. Update status to processing
    await client.query(QR.UPDATE_REFUND_STATUS, ['processing', adminId, null, refundCode]);

    // 4. Gọi payment gateway (mock)
    const paymentReversalSuccess = await reversePayment(refund.payment_id, refund.net_refund_amount);

    if (!paymentReversalSuccess) {
      // Payment reversal failed
      await client.query(QR.UPDATE_REFUND_STATUS, ['failed', adminId, 'Payment gateway reversal failed', refundCode]);
      throw new Error('Không thể hoàn tiền: Payment gateway error');
    }

    // 5. Complete refund
    await client.query(QR.UPDATE_REFUND_COMPLETED, [adminId, refundCode]);

    // 6. Update booking status to refunded
    await client.query(QB.UPDATE_BOOKING_STATUS, ['refunded', refund.booking_id]);

    // 7. Revoke loyalty points (proportional to refund amount)
    try {
      // Calculate % refund based on amount refunded vs total
      const refundPercent = refund.refund_type === 'full' 
        ? 100 
        : Math.round((parseFloat(refund.net_refund_amount) / parseFloat(refund.refund_amount)) * 100);
      
      await revokePointsForRefund(
        refund.booking_id, 
        refund.requested_by,
        refund.refund_type,
        refundPercent
      );
    } catch (loyaltyErr) {
      console.error('[Refund] Loyalty revoke error:', loyaltyErr.message);
      // Không throw để không ảnh hưởng đến refund completion
    }

    // 8. Send notification
    try {
      await createRefundNotification({
        event: 'REFUND_COMPLETED',
        refund: { ...refund, status: 'completed', net_refund_amount: refund.net_refund_amount },
        adminId,
      });
    } catch (notifErr) {
      console.error('[Refund] Notification error:', notifErr.message);
    }

    await client.query('COMMIT');

    return {
      success: true,
      refund_code: refundCode,
      status: 'completed',
      net_refund_amount: refund.net_refund_amount,
      message: 'Hoàn tiền thành công',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// CANCEL REFUND REQUEST (USER hoặc ADMIN)
// =========================================================

const cancelRefundRequest = async (userId, refundCode, reason = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get refund info
    const refundResult = await client.query(QR.SELECT_REFUND_BY_CODE, [refundCode]);
    if (refundResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu hoàn tiền');

    const refund = refundResult.rows[0];

    // 2. Validate status (chỉ pending mới cancel được)
    if (!['pending', 'approved'].includes(refund.status)) {
      throw new Error(`Không thể hủy yêu cầu có trạng thái "${refund.status}"`);
    }

    // 3. Check ownership (userId null = admin/system cancel)
    if (userId && refund.requested_by !== userId) {
      throw new Error('Bạn không có quyền hủy yêu cầu này');
    }

    // 4. Update status
    await client.query(QR.UPDATE_REFUND_STATUS, [
      'cancelled',
      userId || null,
      reason || 'User cancelled request',
      refundCode,
    ]);

    // 5. Revert booking status back to confirmed
    await client.query(QB.UPDATE_BOOKING_STATUS, ['confirmed', refund.booking_id]);

    await client.query('COMMIT');

    return {
      success: true,
      refund_code: refundCode,
      status: 'cancelled',
      message: 'Yêu cầu hoàn tiền đã được hủy',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// PAYMENT REVERSAL (MOCK - Gọi payment gateway)
// =========================================================

const reversePayment = async (paymentId, amount) => {
  // TODO: Implement real payment gateway integration
  // Ví dụ: VNPay, Momo, Stripe, etc.

  // Mock implementation - giả lập thành công
  console.log(`[Payment] Reversing payment ${paymentId} amount ${amount}`);

  // Simulate API call delay
  await new Promise(resolve => setTimeout(resolve, 100));

  // Update payment status in DB
  if (paymentId) {
    await pool.query(
      'UPDATE payments SET status = $1, updated_at = NOW() WHERE id = $2',
      ['REFUNDED', paymentId]
    );
  }

  return true; // Mock success
};

// =========================================================
// CANCEL BOOKING WITH REFUND (FLOW CHO BOOKING ĐÃ THANH TOÁN)
// =========================================================

const cancelWithRefund = async (userId, bookingCode, reason) => {
  // Redirect to refund flow
  return requestRefund(userId, bookingCode, {
    refund_type: 'full',
    reason: reason || 'Yêu cầu hủy booking và hoàn tiền',
  });
};

// =========================================================
// CANCEL BOOKING (CHƯA THANH TOÁN - HỦY TRỰC TIẾP)
// =========================================================

const cancelPendingBooking = async (userId, bookingCode, reason = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get booking
    const bookingResult = await client.query(QB.SELECT_BOOKING_DETAIL, [bookingCode]);
    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const booking = bookingResult.rows[0];

    // 2. Check ownership
    if (userId && booking.user_id && booking.user_id !== userId) {
      throw new Error('Bạn không có quyền hủy booking này');
    }

    // 3. Validate status (chỉ pending hoặc expired mới cancel trực tiếp được)
    if (!['pending', 'expired'].includes(booking.status)) {
      throw new Error(`Không thể hủy booking có trạng thái "${booking.status}". Vui lòng sử dụng tính năng hoàn tiền.`);
    }

    // 4. Release seats
    const seatsNeeded = parseInt(booking.total_adults) + parseInt(booking.total_children);
    await client.query(
      `UPDATE flight_seats
       SET available_seats = available_seats + $1, updated_at = NOW()
       WHERE flight_id = $2 AND seat_class = $3`,
      [seatsNeeded, booking.outbound_flight_id, booking.outbound_seat_class]
    );

    if (booking.trip_type === 'round_trip' && booking.return_flight_id) {
      await client.query(
        `UPDATE flight_seats
         SET available_seats = available_seats + $1, updated_at = NOW()
         WHERE flight_id = $2 AND seat_class = $3`,
        [seatsNeeded, booking.return_flight_id, booking.return_seat_class]
      );
    }

    // 5. Update booking status
    await client.query(QB.UPDATE_BOOKING_STATUS, ['cancelled', booking.id]);

    await client.query('COMMIT');

    return {
      success: true,
      booking_code: bookingCode,
      status: 'cancelled',
      message: 'Booking đã được hủy thành công',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// GET BOOKING REFUNDS
// =========================================================

const getBookingRefunds = async (bookingCode) => {
  const client = await pool.connect();
  try {
    // Get booking ID first
    const bookingResult = await client.query(
      'SELECT id FROM bookings WHERE booking_code = $1',
      [bookingCode.toUpperCase()]
    );

    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const refundResult = await client.query(QR.SELECT_REFUNDS_BY_BOOKING, [bookingResult.rows[0].id]);
    return refundResult.rows;
  } finally {
    client.release();
  }
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  // Core functions
  requestRefund,
  getRefundDetail,
  getUserRefunds,
  getBookingRefunds,

  // Admin functions
  approveRefund,
  rejectRefund,
  processRefund,
  cancelRefundRequest,

  // Helpers
  calculateRefundAmount,
  calculateHoursUntilDeparture,
  validateRefundRequest,

  // Cancel flows
  cancelWithRefund,
  cancelPendingBooking,

  // Payment
  reversePayment,
};
