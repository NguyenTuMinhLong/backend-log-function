'use strict';

/*
=========================================================
DATE CHANGE SERVICE - Business Logic
=========================================================
*/

const pool = require('../config/db');
const QCD = require('../queries/date-change.queries');
const QB = require('../queries/booking.queries');
const QF = require('../queries/flight.queries');
const QR = require('../queries/refund.queries');
const { DATE_CHANGE } = require('../config/refund.config');
const { createDateChangeNotification } = require('./notification.service');
const { sendRefundOTPEmail } = require('../utils/mailer');
const { OTP_CONFIG } = require('../config/refund.config');

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

const dateChangeOTPStore = new Map(); // In-memory store: requestCode -> { otp, expiresAt, attempts }

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

  // 6. Check date range
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
// Hàm gửi OTP cho email
const requestDateChangeOTP = async (email, requestCode) => {
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = Date.now() + OTP_CONFIG.expiresInMinutes * 60 * 1000;

  dateChangeOTPStore.set(email.toLowerCase(), {
    code: otp,
    requestCode,
    expiresAt,
    attempts: 0,
    verified: false,
  });

  // Debug: In OTP ra console (neu email la test)
  console.log(`[DateChange OTP] Code: ${otp} for ${email}`);

  return { expiresIn: OTP_CONFIG.expiresInMinutes };
}
// Hàm verify OTP
const verifyDateChangeOTP = async (email, otp) => {
  const normalizedEmail = email.toLowerCase().trim();
  const otpData = dateChangeOTPStore.get(normalizedEmail);

  if (!otpData) throw new Error('Khong tim thay ma OTP');
  if (Date.now() > otpData.expiresAt) throw new Error('Ma OTP da het han');
  if (otpData.attempts >= OTP_CONFIG.maxAttempts) throw new Error('Qua so lan thu');
  if (otpData.code !== otp) {
    otpData.attempts++;
    throw new Error('Ma OTP khong dung');
  }

  otpData.verified = true;
  return { verified: true };
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

    const bookingResult = await client.query(QB.SELECT_BOOKING_DETAIL, [bookingCode]);
    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const booking = bookingResult.rows[0];

    if (userId && booking.user_id && booking.user_id !== userId) {
      throw new Error('Bạn không có quyền thực hiện yêu cầu này');
    }

    const existingRequest = await client.query(QCD.CHECK_PENDING_DATE_CHANGE_FOR_BOOKING, [booking.id]);
    if (existingRequest.rows.length > 0) {
      throw new Error('Đã có yêu cầu đổi ngày đang chờ xử lý cho booking này');
    }

    const newFlight = await validateDateChangeRequest(booking, new_flight_id, new_seat_class);

    // Check seat availability
    if (DATE_CHANGE.checkSeatAvailability) {
      const passengers = passenger_ids?.length || (parseInt(booking.total_adults) + parseInt(booking.total_children));
      if (newFlight.available_seats < passengers) {
        throw new Error(`Chuyến bay mới không đủ ghế. Còn ${newFlight.available_seats} ghế, cần ${passengers}`);
      }
    }

    const oldPrice = parseFloat(booking.total_price);
    const seatsNeeded = passenger_ids?.length || (parseInt(booking.total_adults) + parseInt(booking.total_children));
    const newFlightPrice = parseFloat(newFlight.base_price);
    const newTotalPrice = newFlightPrice * seatsNeeded;
    const priceDifference = newTotalPrice - oldPrice;

    let requestCode;
    let isUnique = false;
    while (!isUnique) {
      requestCode = generateRequestCode();
      const check = await client.query(QCD.CHECK_DATE_CHANGE_EXISTS_BY_CODE, [requestCode]);
      if (check.rows.length === 0) isUnique = true;
    }

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
      'pending_otp', // Status: cho OTP verification
      reason,
      userId,
    ]);

    const request = requestResult.rows[0];

    // Gui OTP den email
    const bookingEmail = booking.contact_email || booking.guest_email;
    try {
      await requestDateChangeOTP(bookingEmail, request.request_code);
    } catch (otpErr) {
      console.error('[DateChange] OTP send error:', otpErr.message);
    }

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
      price_difference_label: priceDifference > 0 ? 'Ban phai tra them' : priceDifference < 0 ? 'Ban duoc hoan' : 'Khong phai tra them',
      message: `Ma OTP da gui den ${booking.contact_email || booking.guest_email}. Vui long xac thuc OTP de hoan tat yeu cau.`,
      requires_otp: true
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// CONFIRM DATE CHANGE (After OTP Verification)
// =========================================================

const confirmDateChange = async (email, otp, requestCode) => {
  // 1. Verify OTP
  await verifyDateChangeOTP(email, otp);

  // 2. Lay request
  const requestResult = await pool.query(
    QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]
  );
  if (requestResult.rows.length === 0) throw new Error('Khong tim thay yeu cau');
  const request = requestResult.rows[0];

  if (request.status !== 'pending_otp') {
    throw new Error(`Yeu cau da duoc xu ly (status: ${request.status})`);
  }

  // 3. Check auto/manual
  const { AUTO_REFUND } = require('../config/refund.config');
  const absDiff = Math.abs(request.price_difference);

  let newStatus;
  if (AUTO_REFUND.enabled && absDiff < AUTO_REFUND.threshold) {
    // Auto approve
    newStatus = 'approved';
  } else {
    newStatus = 'pending';
  }

  // 4. Update status (simple - no admin needed for OTP verification)
  await pool.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, [newStatus, requestCode]);

  // 5. Neu auto -> goi approve luon
  if (newStatus === 'approved') {
    await approveDateChange(null, requestCode, 'Auto-approved');
  }

  return {
    success: true,
    status: newStatus,
    auto_approved: newStatus === 'approved',
    message: newStatus === 'approved'
      ? 'Yeu cau da duyet tu dong'
      : 'Yeu cau da tiep nhan, cho admin duyet',
  };
};

// =========================================================
// APPROVE DATE CHANGE (ADMIN)  \][-p0i]
// =========================================================

const approveDateChange = async (adminId, requestCode, adminNotes = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];
    console.log(`[DateChange Approve] Request: ${requestCode}, Status: ${request.status}`);

    if (request.status !== 'pending') {
      throw new Error(`Không thể duyệt yêu cầu có trạng thái "${request.status}"`);
    }

    const passengers = request.passenger_ids?.length || 1;
    console.log(`[DateChange Approve] Passengers: ${passengers}`);

    // === CHECK NEW FLIGHT ===
    const newSeatCheck = await client.query(
      'SELECT available_seats, total_seats FROM flight_seats WHERE flight_id = $1 AND class = $2',
      [request.new_flight_id, request.new_seat_class]
    );

    if (newSeatCheck.rows.length === 0) throw new Error('Không tìm thấy ghế chuyến bay mới');

    const newSeat = newSeatCheck.rows[0];
    console.log(`[New Flight] Available: ${newSeat.available_seats}/${newSeat.total_seats}`);

    if (newSeat.available_seats < passengers) {
      throw new Error(`Chuyến bay mới chỉ còn ${newSeat.available_seats} ghế`);
    }

    // === CHECK OLD FLIGHT (nếu có) ===
    if (request.old_flight_id && request.old_seat_class) {
      const oldSeatCheck = await client.query(
        'SELECT available_seats, total_seats FROM flight_seats WHERE flight_id = $1 AND class = $2',
        [request.old_flight_id, request.old_seat_class]
      );

      if (oldSeatCheck.rows.length > 0) {
        const oldSeat = oldSeatCheck.rows[0];
        console.log(`[Old Flight] Current: ${oldSeat.available_seats}/${oldSeat.total_seats}`);

        const newAvailableOld = oldSeat.available_seats + passengers;
        if (newAvailableOld > oldSeat.total_seats) {
          console.warn(`[WARNING] Old flight available will exceed total: ${newAvailableOld} > ${oldSeat.total_seats}`);
          // Tự động điều chỉnh không cho vượt total_seats
        }
      }
    }

    // === RELEASE OLD SEATS (an toàn) ===
    if (request.old_flight_id && request.old_seat_class) {
      await client.query(
        `UPDATE flight_seats 
         SET available_seats = LEAST(available_seats + $1, total_seats), 
             updated_at = NOW()
         WHERE flight_id = $2 AND class = $3`,
        [passengers, request.old_flight_id, request.old_seat_class]
      );
      console.log(`[DateChange] Released ${passengers} seats from old flight`);
    }

    // === RESERVE NEW SEATS ===
    await client.query(
      `UPDATE flight_seats 
       SET available_seats = available_seats - $1, 
           updated_at = NOW()
       WHERE flight_id = $2 AND class = $3`,
      [passengers, request.new_flight_id, request.new_seat_class]
    );
    console.log(`[DateChange] Reserved ${passengers} seats on new flight`);

    // Update booking & status
    await client.query(QCD.UPDATE_BOOKING_FLIGHT, [
      request.new_flight_id,
      request.new_seat_class,
      request.booking_id,
    ]);

    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'approved',
      adminId,
      adminNotes,
      requestCode,
    ]);

    await client.query('COMMIT');
    console.log(`[DateChange Approve] SUCCESS: ${requestCode}`);

    return {
      success: true,
      request_code: requestCode,
      status: 'approved',
      message: 'Yêu cầu đổi ngày bay đã được duyệt thành công',
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[DateChange Approve ERROR] ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
};

// =========================================================
// REJECT + CANCEL + GET (giữ nguyên)
// =========================================================

const rejectDateChange = async (adminId, requestCode, reason) => {
  if (!reason || reason.trim().length < 10) {
    throw new Error('Vui lòng nhập lý do từ chối (ít nhất 10 ký tự)');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      throw new Error(`Không thể từ chối yêu cầu có trạng thái "${request.status}"`);
    }

    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'rejected',
      adminId,
      reason,
      requestCode,
    ]);

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

const cancelDateChangeRequest = async (userId, requestCode) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];

    if (request.status !== 'pending') {
      throw new Error(`Không thể hủy yêu cầu có trạng thái "${request.status}"`);
    }

    if (userId && request.requested_by !== userId) {
      throw new Error('Bạn không có quyền hủy yêu cầu này');
    }

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

const getDateChangeDetail = async (requestCode) => {
  const result = await pool.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
  if (result.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');
  return result.rows[0];
};

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

module.exports = {
  requestDateChange,
  approveDateChange,
  rejectDateChange,
  cancelDateChangeRequest,
  getDateChangeDetail,
  getBookingDateChanges,
  getUserDateChanges,
  validateDateChangeRequest,
  confirmDateChange,
};