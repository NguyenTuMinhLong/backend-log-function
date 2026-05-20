'use strict';

/*
=========================================================
DATE CHANGE SERVICE - Business Logic
=========================================================

Cho phép user đổi ngày bay / rebooking
=========================================================
*/

const pool = require('../config/db');
const QCD = require('../queries/date-change.queries');
const QB = require('../queries/booking.queries');
const QF = require('../queries/flight.queries');
const QR = require('../queries/refund.queries');
const { DATE_CHANGE } = require('../config/refund.config');
const { createDateChangeNotification } = require('./notification.service');

const generateRefundCode = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `REF-DC-${date}-${s}`;
};

// =========================================================
// HELPERS
// =========================================================

const generateRequestCode = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let suffix = '';
  for (let i = 0; i < 6; i++) {
    suffix += chars[Math.floor(Math.random() * chars.length)];
  }
  return `DCR-${date}-${suffix}`;
};

const validateDateChangeRequest = async (booking, newFlightId, seatClass) => {
  // 1. Booking phải confirmed
  if (booking.status !== 'confirmed') {
    throw new Error(`Không thể đổi ngày bay cho booking có trạng thái "${booking.status}"`);
  }

  // 2. Check thời gian trước departure
  const hoursUntilDeparture = (new Date(booking.outbound_departure_time) - new Date()) / (1000 * 60 * 60);
  if (DATE_CHANGE.minHoursBeforeFlight && hoursUntilDeparture < DATE_CHANGE.minHoursBeforeFlight) {
    throw new Error(`Không thể đổi ngày bay khi còn ít hơn ${DATE_CHANGE.minHoursBeforeFlight} tiếng trước giờ khởi hành`);
  }

  // 3. Validate new flight exists
  const flightResult = await pool.query(QF.SELECT_SEAT_INFO, [newFlightId, seatClass]);
  if (flightResult.rows.length === 0) {
    throw new Error(`Không tìm thấy chuyến bay hoặc hạng ghế "${seatClass}" cho chuyến bay mới`);
  }

  const newFlight = flightResult.rows[0];

  // 4. Check flight status
  if (newFlight.status !== 'scheduled') {
    throw new Error(`Chuyến bay mới không còn khả dụng (status: ${newFlight.status})`);
  }

  // 5. Check flight departure time is in future
  if (new Date(newFlight.departure_time) <= new Date()) {
    throw new Error('Chuyến bay mới đã khởi hành');
  }

  // 6. Check date range (không đổi quá xa)
  if (DATE_CHANGE.maxDateRange) {
    const currentDeparture = new Date(booking.outbound_departure_time);
    const newDeparture = new Date(newFlight.departure_time);
    const daysDiff = Math.abs((newDeparture - currentDeparture) / (1000 * 60 * 60 * 24));
    if (daysDiff > DATE_CHANGE.maxDateRange) {
      throw new Error(`Không thể đổi sang ngày cách hơn ${DATE_CHANGE.maxDateRange} ngày`);
    }
  }

  return newFlight;
};

// =========================================================
// REQUEST DATE CHANGE (USER)
// =========================================================

const requestDateChange = async (userId, bookingCode, data) => {
  const {
    new_flight_id,
    new_seat_class,
    passenger_ids = null,
    reason,
  } = data;

  // Validate inputs
  if (!new_flight_id) throw new Error('new_flight_id là bắt buộc');
  if (!new_seat_class) throw new Error('new_seat_class là bắt buộc');
  if (!['economy', 'business', 'first'].includes(new_seat_class)) {
    throw new Error('new_seat_class phải là: economy, business, hoặc first');
  }
  if (!reason || reason.trim().length < 10) {
    throw new Error('Lý do yêu cầu phải có ít nhất 10 ký tự');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get booking
    const bookingResult = await client.query(QB.SELECT_BOOKING_DETAIL, [bookingCode]);
    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const booking = bookingResult.rows[0];

    // 2. Check ownership
    if (userId && booking.user_id && booking.user_id !== userId) {
      throw new Error('Bạn không có quyền thực hiện yêu cầu này');
    }

    // 3. Check no pending request
    const existingRequest = await client.query(QCD.CHECK_PENDING_DATE_CHANGE_FOR_BOOKING, [booking.id]);
    if (existingRequest.rows.length > 0) {
      throw new Error('Đã có yêu cầu đổi ngày đang chờ xử lý cho booking này');
    }

    // 4. Validate request
    const newFlight = await validateDateChangeRequest(booking, new_flight_id, new_seat_class);

    // 5. Check seat availability
    if (DATE_CHANGE.checkSeatAvailability) {
      const passengers = passenger_ids?.length || (parseInt(booking.total_adults) + parseInt(booking.total_children));
      if (newFlight.available_seats < passengers) {
        throw new Error(`Chuyến bay mới không đủ ghế. Còn ${newFlight.available_seats} ghế, cần ${passengers}`);
      }
    }

    // 6. Calculate prices
    const oldPrice = parseFloat(booking.total_price);
    const seatsNeeded = passenger_ids?.length || (parseInt(booking.total_adults) + parseInt(booking.total_children));

    // Get new flight price
    const newFlightPrice = parseFloat(newFlight.base_price);
    const newTotalPrice = newFlightPrice * seatsNeeded;

    const priceDifference = newTotalPrice - oldPrice;

    // 7. Generate request code
    let requestCode;
    let isUnique = false;
    while (!isUnique) {
      requestCode = generateRequestCode();
      const check = await client.query(QCD.CHECK_DATE_CHANGE_EXISTS_BY_CODE, [requestCode]);
      if (check.rows.length === 0) isUnique = true;
    }

    // 8. Create request
    const requestResult = await client.query(QCD.INSERT_DATE_CHANGE, [
      requestCode,
      booking.id,
      booking.outbound_flight_id,
      new_flight_id,
      booking.outbound_seat_class,
      new_seat_class,
      passenger_ids ? JSON.stringify(passenger_ids) : null,
      oldPrice,
      newTotalPrice,
      priceDifference,
      'pending',
      reason,
      userId,
    ]);

    const request = requestResult.rows[0];

    // 9. Send notification
    try {
      await createDateChangeNotification({
        event: 'DATE_CHANGE_REQUESTED',
        request,
        booking,
        userId,
      });
    } catch (notifErr) {
      console.error('[DateChange] Notification error:', notifErr.message);
    }

    await client.query('COMMIT');

    return {
      success: true,
      request_code: request.request_code,
      status: request.status,
      old_flight: {
        flight_id: booking.outbound_flight_id,
        flight_number: booking.outbound_flight_number,
        departure_time: booking.outbound_departure_time,
        seat_class: booking.outbound_seat_class,
      },
      new_flight: {
        flight_id: new_flight_id,
        flight_number: newFlight.flight_number,
        departure_time: newFlight.departure_time,
        seat_class: new_seat_class,
      },
      price_difference: priceDifference,
      price_difference_label: priceDifference > 0 ? 'Bạn phải trả thêm' : priceDifference < 0 ? 'Bạn được hoàn' : 'Không phải trả thêm',
      message: `Yêu cầu đổi ngày bay đã được tiếp nhận. Mã yêu cầu: ${request.request_code}`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// APPROVE DATE CHANGE (ADMIN)
// =========================================================

const approveDateChange = async (adminId, requestCode, adminNotes = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get request
    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];

    // 2. Validate status
    if (request.status !== 'pending') {
      throw new Error(`Không thể duyệt yêu cầu có trạng thái "${request.status}"`);
    }

    // 3. Check seat availability
    const passengers = request.passenger_ids?.length || 1;
    const seatCheck = await client.query(
      'SELECT available_seats FROM flight_seats WHERE flight_id = $1 AND seat_class = $2',
      [request.new_flight_id, request.new_seat_class]
    );

    if (seatCheck.rows.length === 0 || seatCheck.rows[0].available_seats < passengers) {
      throw new Error('Chuyến bay mới không còn đủ ghế');
    }

    // 4. Release old flight seats
    await client.query(
      `UPDATE flight_seats
       SET available_seats = available_seats + $1, updated_at = NOW()
       WHERE flight_id = $2 AND seat_class = $3`,
      [passengers, request.old_flight_id, request.old_seat_class]
    );

    // 5. Reserve new flight seats
    await client.query(
      `UPDATE flight_seats
       SET available_seats = available_seats - $1, updated_at = NOW()
       WHERE flight_id = $2 AND seat_class = $3`,
      [passengers, request.new_flight_id, request.new_seat_class]
    );

    // 6. Update booking with new flight
    await client.query(QCD.UPDATE_BOOKING_FLIGHT, [
      request.new_flight_id,
      request.new_seat_class,
      request.booking_id,
    ]);

    // 7. Update request status
    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'approved',
      adminId,
      adminNotes,
      requestCode,
    ]);

    // 8. Handle price difference
    let paymentResult = null;
    if (request.price_difference > 0) {
      // User phải trả thêm — tạm ghi nhận, admin sẽ xử lý thu tiền thủ công
      paymentResult = { action: 'charge', amount: request.price_difference, note: 'Cần thu thêm từ user' };
    } else if (request.price_difference < 0) {
      // User được hoàn vì chuyến mới rẻ hơn — tạo refund record tự động
      const refundAmount = Math.abs(request.price_difference);
      const refundCode = generateRefundCode();

      await client.query(QR.INSERT_REFUND, [
        refundCode,                              // $1 refund_code
        request.booking_id,                      // $2 booking_id
        'date_change_refund',                    // $3 refund_type
        null,                                    // $4 requested_items
        refundAmount,                            // $5 refund_amount
        0,                                       // $6 admin_fee
        refundAmount,                            // $7 net_refund_amount
        'date_change',                           // $8 refund_policy_applied
        'approved',                              // $9 status — auto-approve vì admin đã duyệt date change
        `Hoàn tiền chênh lệch giá do đổi chuyến bay (mã: ${requestCode})`, // $10 reason
        null,                                    // $11 user_notes
        request.user_id || null,                 // $12 requested_by
        !request.user_id,                        // $13 is_guest
        null,                                    // $14 guest_email
      ]);

      paymentResult = { action: 'refund', amount: refundAmount, refund_code: refundCode };
      console.log(`[DateChange] Tạo auto-refund ${refundCode} — ${refundAmount.toLocaleString('vi-VN')} VNĐ`);
    }

    // 9. Send notification
    try {
      await createDateChangeNotification({
        event: 'DATE_CHANGE_APPROVED',
        request: { ...request, status: 'approved', admin_notes: adminNotes },
        booking: { booking_code: request.booking_code },
        adminId,
      });
    } catch (notifErr) {
      console.error('[DateChange] Notification error:', notifErr.message);
    }

    await client.query('COMMIT');

    return {
      success: true,
      request_code: requestCode,
      status: 'approved',
      price_difference_action: paymentResult,
      message: 'Yêu cầu đổi ngày bay đã được duyệt',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// REJECT DATE CHANGE (ADMIN)
// =========================================================

const rejectDateChange = async (adminId, requestCode, reason) => {
  if (!reason || reason.trim().length < 10) {
    throw new Error('Vui lòng nhập lý do từ chối (ít nhất 10 ký tự)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get request
    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];

    // 2. Validate status
    if (request.status !== 'pending') {
      throw new Error(`Không thể từ chối yêu cầu có trạng thái "${request.status}"`);
    }

    // 3. Update status
    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'rejected',
      adminId,
      reason,
      requestCode,
    ]);

    // 4. Send notification
    try {
      await createDateChangeNotification({
        event: 'DATE_CHANGE_REJECTED',
        request: { ...request, status: 'rejected', admin_notes: reason },
        booking: { booking_code: request.booking_code },
        adminId,
      });
    } catch (notifErr) {
      console.error('[DateChange] Notification error:', notifErr.message);
    }

    await client.query('COMMIT');

    return {
      success: true,
      request_code: requestCode,
      status: 'rejected',
      message: 'Yêu cầu đổi ngày bay đã bị từ chối',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// CANCEL DATE CHANGE REQUEST (USER)
// =========================================================

const cancelDateChangeRequest = async (userId, requestCode) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get request
    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];

    // 2. Validate status
    if (request.status !== 'pending') {
      throw new Error(`Không thể hủy yêu cầu có trạng thái "${request.status}"`);
    }

    // 3. Check ownership
    if (userId && request.requested_by !== userId) {
      throw new Error('Bạn không có quyền hủy yêu cầu này');
    }

    // 4. Update status
    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'cancelled',
      userId,
      'User cancelled request',
      requestCode,
    ]);

    await client.query('COMMIT');

    return {
      success: true,
      request_code: requestCode,
      status: 'cancelled',
      message: 'Yêu cầu đổi ngày bay đã được hủy',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// GET DATE CHANGE DETAIL
// =========================================================

const getDateChangeDetail = async (requestCode) => {
  const result = await pool.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
  if (result.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');
  return result.rows[0];
};

// =========================================================
// GET BOOKING DATE CHANGES
// =========================================================

const getBookingDateChanges = async (bookingCode) => {
  const client = await pool.connect();
  try {
    const bookingResult = await client.query(
      'SELECT id FROM bookings WHERE booking_code = $1',
      [bookingCode.toUpperCase()]
    );

    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const result = await client.query(QCD.SELECT_DATE_CHANGES_BY_BOOKING, [bookingResult.rows[0].id]);
    return result.rows;
  } finally {
    client.release();
  }
};

// =========================================================
// GET USER DATE CHANGES
// =========================================================

const getUserDateChanges = async (userId, page = 1, limit = 10) => {
  const offset = (parseInt(page) - 1) * parseInt(limit);

  const dataResult = await pool.query(QCD.SELECT_USER_DATE_CHANGES, [userId, parseInt(limit), offset]);
  const total = dataResult.rows.length;

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
// EXPORTS
// =========================================================

module.exports = {
  // Core functions
  requestDateChange,
  approveDateChange,
  rejectDateChange,
  cancelDateChangeRequest,
  getDateChangeDetail,
  getBookingDateChanges,
  getUserDateChanges,

  // Helpers
  validateDateChangeRequest,
};
