'use strict';

/*
============================================================
DATE CHANGE SERVICE - Đổi ngày bay
============================================================

Quy trình:
1. User gửi yêu cầu đổi ngày (requestDateChange)
2. Hệ thống gửi OTP qua email
3. User xác thực OTP (confirmDateChange)
4. Nếu chênh lệch giá > 0 → tạo payment để thanh toán
5. Sau khi thanh toán → auto approve (approveDateChange)
6. Admin có thể reject/reapprove

Business Rules:
- Phải đổi trước >= 24h giờ bay
- Chênh lệch < 1M → auto approve
- Chênh lệch >= 1M → cần admin duyệt
============================================================
*/

const pool = require('../config/db');
const QCD = require('../queries/date-change.queries');
const QB = require('../queries/booking.queries');
const QF = require('../queries/flight.queries');
const QR = require('../queries/refund.queries');
const QP = require('../queries/payment.queries');
const { DATE_CHANGE } = require('../config/refund.config');
const { createDateChangeNotification } = require('./notification.service');
const { sendRefundOTPEmail } = require('../utils/mailer');
const { OTP_CONFIG } = require('../config/refund.config');
const { buildPaymentInstruction } = require('../utils/formatters');
const paymentConfig = require('../config/payment.config');

// Import providers
const { createPayosPaymentInstruction } = require('../providers/payos.provider');
const { createMomoPaymentInstruction } = require('../providers/momo.provider');
const { createPayPalOrder } = require('../providers/paypal.provider');
const { createBankQrInstruction } = require('../providers/bankqr.provider');

const generateRefundCode = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `REF-DC-${date}-${s}`;
};

// HELPERS

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
  const expiresAt = new Date(Date.now() + OTP_CONFIG.expiresInMinutes * 60 * 1000);

  // Lưu OTP vào cột của date_change_requests (persist qua DB)
  await pool.query(
    `UPDATE date_change_requests
     SET otp_code = $1, otp_expires_at = $2, otp_attempts = 0
     WHERE request_code = $3`,
    [otp, expiresAt, requestCode]
  );

  // Bug 2 Fix: Thực sự gửi email (trước đây chỉ console.log)
  try {
    await sendRefundOTPEmail(email, otp);
  } catch (emailErr) {
    console.error('[DateChange OTP] Email send failed:', emailErr.message);
  }

  console.log(`[DateChange OTP] Sent to ${email} for request ${requestCode}`);
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

  return { verified: true };
};

// HELPERS FOR PAYMENT

const generateDateChangePaymentCode = () => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `PAY-DC-${timestamp}-${random}`;
};

const mapDateChangePayment = (payment, providerPayload = {}) => ({
  ...payment,
  method: payment.payment_method,
  instruction: buildPaymentInstruction({
    payment,
    providerPayload,
    bankConfig: paymentConfig.bankQr,
    payosConfig: paymentConfig.payos,
    momoConfig: paymentConfig.momo,
    paypalConfig: paymentConfig.paypal,
  }),
});

const isTerminalPaidStatus = (status) =>
  ['PAID', 'SUCCESS', 'COMPLETED', 'CONFIRMED'].includes(String(status || '').toUpperCase());

const getDateChangePaymentByCodeRow = async (paymentCode) => {
  const { rows } = await pool.query(
    'SELECT * FROM payments WHERE payment_code = $1 LIMIT 1',
    [paymentCode]
  );
  return rows[0] || null;
};

const updateDateChangePaymentProviderFields = async (paymentCode, fields = {}) => {
  const query = `
    UPDATE payments SET
      qr_payload = COALESCE($2, qr_payload),
      bank_code = COALESCE($3, bank_code),
      bank_account = COALESCE($4, bank_account),
      transfer_content = COALESCE($5, transfer_content),
      gateway_transaction_id = COALESCE($6, gateway_transaction_id),
      gateway_response = COALESCE($7::jsonb, gateway_response)
    WHERE payment_code = $1
    RETURNING *
  `;
  const values = [
    paymentCode,
    fields.qr_payload || null,
    fields.bank_code || null,
    fields.bank_account || null,
    fields.transfer_content || null,
    fields.gateway_transaction_id || null,
    fields.gateway_response ? JSON.stringify(fields.gateway_response) : null,
  ];
  const { rows } = await pool.query(query, values);
  return rows[0] || null;
};

// ─── USER REQUEST DATE CHANGE ───────────────────────────────

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

    const seatsNeeded = passenger_ids?.length || (parseInt(booking.total_adults) + parseInt(booking.total_children));
    const newFlightPrice = parseFloat(newFlight.base_price);
    const newTotalPrice = newFlightPrice * seatsNeeded;
    // So sánh đúng: giá vé outbound × số ghế (không bao gồm hành lý, ancillary, chuyến về)
    const oldPrice = parseFloat(booking.base_price) * seatsNeeded;
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

    // Gửi OTP SAU KHI COMMIT — dùng pool.query() nên cần row đã được commit trước
    const bookingEmail = booking.contact_email || booking.guest_email;
    try {
      await requestDateChangeOTP(bookingEmail, request.request_code);
    } catch (otpErr) {
      console.error('[DateChange] OTP send error:', otpErr.message);
    }

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

// ─── CONFIRM DATE CHANGE (sau khi verify OTP) ─────────────────

const confirmDateChange = async (email, otp, requestCode) => {
  // 1. Verify OTP từ DB (Bug 3+4 Fix: dùng requestCode làm key)
  await verifyDateChangeOTP(email, otp, requestCode);

  // 2. Lấy request
  const requestResult = await pool.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
  if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu');
  const request = requestResult.rows[0];

  if (request.status !== 'pending_otp') {
    throw new Error(`Yêu cầu đã được xử lý (status: ${request.status})`);
  }

  // 3. Kiểm tra payment có cần không (price_difference > 0)
  const absDiff = Math.abs(parseFloat(request.price_difference));
  const requiresPayment = request.price_difference > 0 && DATE_CHANGE.priceDifference?.chargeIfPositive;

  if (requiresPayment) {
    await pool.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, ['pending_payment', requestCode]);
    return {
      success: true,
      status: 'pending_payment',
      requires_payment: true,
      price_difference: parseFloat(request.price_difference),
      message: 'Quý khách cần thanh toán phụ phí để hoàn tất yêu cầu đổi ngày bay',
    };
  }

  // 4. Không cần payment → auto approve hoặc chờ admin
  const { AUTO_REFUND } = require('../config/refund.config');
  const autoApprove = AUTO_REFUND.enabled && absDiff < AUTO_REFUND.threshold;

  // Fix Bug 2: luôn set 'pending' trước — approveDateChange yêu cầu status = 'pending'
  await pool.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, ['pending', requestCode]);

  if (autoApprove) {
    await approveDateChange(null, requestCode, 'Auto-approved sau OTP verification');
  }


  return {
    success: true,
    status: 'pending',
    auto_approved: false,
    message: 'Yêu cầu đổi ngày bay đã được tiếp nhận, chờ admin duyệt',
  };
};

// ─── CREATE PAYMENT CHO CHÊNH LỆCH GIÁ ───────────────────

const createDateChangePayment = async (requestCode, paymentMethod, userId = null) => {
  // 1. Validate payment method early
  const validMethods = DATE_CHANGE.payment?.methods || ['BANK_QR', 'MOMO', 'PAYPAL'];
  const normalizedMethod = String(paymentMethod || '').toUpperCase();
  if (!validMethods.includes(normalizedMethod)) {
    throw new Error(`Phuong thuc thanh toan phai la: ${validMethods.join(', ')}`);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Lock the date change request to prevent race condition
    const lockQuery = `
      SELECT dcr.*, b.booking_code 
      FROM date_change_requests dcr
      JOIN bookings b ON dcr.booking_id = b.id
      WHERE dcr.request_code = $1
      FOR UPDATE OF dcr
    `;
    const lockedResult = await client.query(lockQuery, [requestCode]);
    if (lockedResult.rows.length === 0) throw new Error('Khong tim thay yeu cau doi ngay bay');
    const request = lockedResult.rows[0];

    if (request.status !== 'pending_payment') {
      throw new Error(`Khong the tao thanh toan cho yeu cau o trang thai "${request.status}"`);
    }

    if (request.price_difference <= 0) {
      throw new Error('Yeu cau nay khong can thanh toan them');
    }

    // 3. Check if payment already exists (with lock held)
    if (request.payment_id && request.payment_code) {
      const existingPayment = await getDateChangePaymentByCodeRow(request.payment_code);
      if (existingPayment && !isTerminalPaidStatus(existingPayment.status)) {
        await client.query('COMMIT');
        return {
          ...mapDateChangePayment(existingPayment),
          request_code: requestCode,
          price_difference: parseFloat(request.price_difference),
        };
      }
    }

    // 4. Create payment record
    const paymentCode = generateDateChangePaymentCode();
    const amount = parseFloat(request.price_difference);
    const expiresAt = new Date(Date.now() + (DATE_CHANGE.payment?.expiryMinutes || 30) * 60 * 1000);

    const paymentResult = await client.query(`
      INSERT INTO payments (
        booking_id, user_id, payment_code, payment_method,
        amount, discount_amount, final_amount,
        status, expires_at, created_at, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 0, $5, 'PENDING', $6, NOW(), NOW())
      RETURNING *
    `, [
      request.booking_id,
      request.requested_by || userId,
      paymentCode,
      normalizedMethod,
      amount,
      expiresAt,
    ]);

    const payment = paymentResult.rows[0];

    // 5. Update date_change_request with payment info
    await client.query(QCD.UPDATE_DATE_CHANGE_PAYMENT_ID, [
      payment.id,
      paymentCode,
      requestCode,
    ]);

    await client.query('COMMIT');

    // 5. Generate payment instruction based on method
    let providerPayload = {};

    if (normalizedMethod === 'BANK_QR') {
      if (paymentConfig.payos.enabled) {
        providerPayload = await createPayosPaymentInstruction(payment);
      } else {
        providerPayload = createBankQrInstruction(payment);
      }
      await updateDateChangePaymentProviderFields(paymentCode, {
        qr_payload: providerPayload.qr_payload,
        bank_code: providerPayload.bank_code,
        bank_account: providerPayload.bank_account,
        transfer_content: providerPayload.transfer_content || paymentCode,
        gateway_response: {
          provider: paymentConfig.payos.enabled ? 'PAYOS' : 'BANK_QR',
          generatedAt: new Date().toISOString(),
        },
      });
    }

    if (normalizedMethod === 'MOMO') {
      if (!paymentConfig.momo.enabled) {
        throw new Error('MoMo payment is not configured');
      }
      providerPayload = await createMomoPaymentInstruction(payment);
      await updateDateChangePaymentProviderFields(paymentCode, {
        qr_payload: providerPayload.qr_payload,
        gateway_response: {
          ...providerPayload,
          provider: 'MOMO',
          generatedAt: new Date().toISOString(),
        },
      });
    }

    if (normalizedMethod === 'PAYPAL') {
      if (!paymentConfig.paypal.enabled) {
        throw new Error('PayPal payment is not configured');
      }
      providerPayload = await createPayPalOrder(payment);
      await updateDateChangePaymentProviderFields(paymentCode, {
        gateway_response: {
          ...providerPayload,
          provider: 'PAYPAL',
          generatedAt: new Date().toISOString(),
        },
      });
    }

    // Fetch updated payment
    const updatedPayment = await getDateChangePaymentByCodeRow(paymentCode);

    return {
      ...mapDateChangePayment(updatedPayment, providerPayload),
      request_code: requestCode,
      price_difference: amount,
      expires_at: expiresAt,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── CONFIRM PAYMENT ĐÃ THANH TOÁN ──────────────────────────

const confirmDateChangePayment = async (paymentCode) => {
  // 1. Find payment
  const payment = await getDateChangePaymentByCodeRow(paymentCode);
  if (!payment) throw new Error('Khong tim thay thanh toan');

  if (isTerminalPaidStatus(payment.status)) {
    const requestResult = await pool.query(QCD.SELECT_DATE_CHANGE_BY_PAYMENT_CODE, [paymentCode]);
    return {
      success: true,
      already_processed: true,
      status: requestResult.rows[0]?.status,
      message: 'Payment already processed',
    };
  }

  // 2. Find date change request
  const requestResult = await pool.query(QCD.SELECT_DATE_CHANGE_BY_PAYMENT_CODE, [paymentCode]);
  if (requestResult.rows.length === 0) throw new Error('Khong tim thay yeu cau doi ngay bay');
  const request = requestResult.rows[0];

  if (request.status !== 'pending_payment') {
    throw new Error(`Yeu cau da duoc xu ly (status: ${request.status})`);
  }

  // 3. Check payment expiry
  if (payment.expires_at && new Date() > new Date(payment.expires_at)) {
    await pool.query(`
      UPDATE payments SET status = 'EXPIRED', updated_at = NOW() WHERE payment_code = $1
    `, [paymentCode]);
    throw new Error('Payment da het han. Vui long tao thanh toan moi.');
  }

  // 4. Validate amount matches
  const expectedAmount = parseFloat(request.price_difference);
  const receivedAmount = parseFloat(payment.amount);
  if (receivedAmount !== expectedAmount) {
    throw new Error(`So tien khong dung. Expected: ${expectedAmount}, Received: ${receivedAmount}`);
  }

  // 5. Update payment to SUCCESS
  await pool.query(`
    UPDATE payments 
    SET status = 'SUCCESS', paid_at = NOW(), updated_at = NOW()
    WHERE payment_code = $1
  `, [paymentCode]);

  // 6. Set status='pending' trước để approveDateChange có thể chạy
  // (approveDateChange yêu cầu status='pending', không được set 'approved' trước)
  await pool.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, ['pending', request.request_code]);

  // 7. Execute the actual date change (release old seats, reserve new seats, update booking)
  await approveDateChange(null, request.request_code, 'Payment confirmed automatically');

  // 8. Mark paid_at
  await pool.query(`UPDATE date_change_requests SET paid_at = NOW() WHERE request_code = $1`, [request.request_code]);

  return {
    success: true,
    status: 'approved',
    message: 'Thanh toan thanh cong. Yeu cau doi ngay bay da duoc duyet.',
  };
};

// GET DATE CHANGE PAYMENT STATUS

const getDateChangePaymentStatus = async (requestCode) => {
  const requestResult = await pool.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
  if (requestResult.rows.length === 0) throw new Error('Khong tim thay yeu cau doi ngay bay');
  const request = requestResult.rows[0];

  if (!request.payment_code) {
    return {
      request_code: requestCode,
      status: request.status,
      price_difference: parseFloat(request.price_difference),
      payment: null,
    };
  }

  const payment = await getDateChangePaymentByCodeRow(request.payment_code);

  return {
    request_code: requestCode,
    status: request.status,
    price_difference: parseFloat(request.price_difference),
    payment: payment ? mapDateChangePayment(payment) : null,
  };
};

// CANCEL DATE CHANGE PAYMENT

const cancelDateChangePayment = async (requestCode) => {
  const requestResult = await pool.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
  if (requestResult.rows.length === 0) throw new Error('Khong tim thay yeu cau doi ngay bay');
  const request = requestResult.rows[0];

  if (request.status !== 'pending_payment') {
    throw new Error(`Khong the huy thanh toan cho yeu cau o trang thai "${request.status}"`);
  }

  if (!request.payment_code) {
    throw new Error('Yeu cau nay chua co thanh toan de huy');
  }

  const payment = await getDateChangePaymentByCodeRow(request.payment_code);
  if (!payment) throw new Error('Khong tim thay thanh toan');

  if (isTerminalPaidStatus(payment.status)) {
    throw new Error('Khong the huy thanh toan da hoan tat');
  }

  await pool.query(`
    UPDATE payments 
    SET status = 'CANCELLED', updated_at = NOW() 
    WHERE payment_code = $1
  `, [request.payment_code]);

  return {
    success: true,
    request_code: requestCode,
    payment_code: request.payment_code,
    message: 'Da huy thanh toan thanh cong',
  };
};

// APPROVE DATE CHANGE (ADMIN)  \][-p0i]

const approveDateChange = async (adminId, requestCode, adminNotes = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_CODE, [requestCode]);
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];
    console.log(`[DateChange Approve] Request: ${requestCode}, Status: ${request.status}`);

    // Block approval if request is waiting for payment
    if (request.status === 'pending_payment') {
      throw new Error('Yeu cau dang cho thanh toan. Vui long thanh toan truoc khi duyet.');
    }

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

    // === HUỶ ANCILLARY OUTBOUND (trừ bảo hiểm) ===
    const cancelAncResult = await client.query(`
      UPDATE booking_ancillaries ba
      SET status = 'cancelled', updated_at = NOW()
      FROM ancillary_options ao
      WHERE ba.ancillary_option_id = ao.id
        AND ba.booking_id = $1
        AND ba.flight_type = 'outbound'
        AND ao.type != 'insurance'
        AND ba.status != 'cancelled'
      RETURNING ba.total_price
    `, [request.booking_id]);
    const cancelledAncillaryTotal = cancelAncResult.rows
      .reduce((sum, r) => sum + parseFloat(r.total_price), 0);
    console.log(`[DateChange] Cancelled ancillary total: ${cancelledAncillaryTotal}`);

    // === CẬP NHẬT TOTAL_PRICE BOOKING ===
    const bookingRow = await client.query(
      `SELECT total_price FROM bookings WHERE id = $1`, [request.booking_id]
    );
    const currentBookingTotal = parseFloat(bookingRow.rows[0]?.total_price || 0);
    const oldTicketPrice = parseFloat(request.old_price);
    const newTicketPrice = parseFloat(request.new_price);
    const ticketDiff = newTicketPrice - oldTicketPrice;
    const updatedBookingTotal = Math.max(0, currentBookingTotal + ticketDiff - cancelledAncillaryTotal);

    await client.query(
      `UPDATE bookings SET total_price = $1, updated_at = NOW() WHERE id = $2`,
      [updatedBookingTotal, request.booking_id]
    );
    console.log(`[DateChange] Updated booking total: ${currentBookingTotal} → ${updatedBookingTotal}`);

    // === AUTO-CREATE REFUND NẾU USER ĐƯỢC HOÀN TIỀN ===
    // Hoàn = tiền vé giảm (nếu có) + tiền dịch vụ đã huỷ
    const ticketRefund = Math.max(0, -ticketDiff);
    const refundableAmount = ticketRefund + cancelledAncillaryTotal;
    let relatedRefundCode = null;

    if (refundableAmount > 0) {
      const refundCode = generateRefundCode();
      const parts = [];
      if (ticketRefund > 0) parts.push(`chênh lệch vé ${ticketRefund.toLocaleString('vi-VN')} VND`);
      if (cancelledAncillaryTotal > 0) parts.push(`dịch vụ huỷ ${cancelledAncillaryTotal.toLocaleString('vi-VN')} VND`);

      const refundResult = await client.query(`
        INSERT INTO refunds (
          refund_code, booking_id, refund_type, requested_items,
          refund_amount, admin_fee, net_refund_amount, refund_policy_applied,
          status, reason, requested_by
        ) VALUES ($1, $2, 'partial_leg', $3::jsonb, $4, 0, $4, $5::jsonb, 'pending', $6, $7)
        RETURNING id
      `, [
        refundCode,
        request.booking_id,
        JSON.stringify({ type: 'date_change', request_code: requestCode }),
        refundableAmount,
        JSON.stringify({ name: 'date_change_refund' }),
        `Hoàn tiền do đổi ngày bay (${requestCode}): ${parts.join(' + ')}`,
        adminId || null,
      ]);
      relatedRefundCode = refundCode;

      await client.query(
        `UPDATE date_change_requests SET related_refund_id = $1 WHERE request_code = $2`,
        [refundResult.rows[0].id, requestCode]
      );
      console.log(`[DateChange] Auto-created refund ${refundCode}: ${refundableAmount} VND`);
    }

    // === GHI NOTE PHỤ THU NẾU USER CẦN TRẢ THÊM ===
    const surchargeAmount = Math.max(0, ticketDiff - cancelledAncillaryTotal);
    const finalAdminNotes = surchargeAmount > 0
      ? `${adminNotes ? adminNotes + ' | ' : ''}PHỤ THU: ${surchargeAmount.toLocaleString('vi-VN')} VND chưa thu từ khách`
      : adminNotes;

    // Update booking flight & status
    await client.query(QCD.UPDATE_BOOKING_FLIGHT, [
      request.new_flight_id,
      request.new_seat_class,
      request.booking_id,
    ]);

    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'approved',
      adminId,
      finalAdminNotes,
      requestCode,
    ]);

    await client.query('COMMIT');
    console.log(`[DateChange Approve] SUCCESS: ${requestCode}`);

    return {
      success: true,
      request_code: requestCode,
      status: 'approved',
      message: 'Yêu cầu đổi ngày bay đã được duyệt thành công',
      price_settled: {
        ticket_difference:        ticketDiff,
        cancelled_ancillary_total: cancelledAncillaryTotal,
        refund_amount:            refundableAmount,
        refund_code:              relatedRefundCode,
        surcharge_amount:         surchargeAmount,
      },
    };

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`[DateChange Approve ERROR] ${err.message}`);
    throw err;
  } finally {
    client.release();
  }
};


// ─── ADMIN REJECT ──────────────────────────────────────────

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

    // Bug 5 Fix: cho phép reject cả 'pending_otp' (chưa xác nhận OTP) và 'pending'
    if (!['pending', 'pending_otp'].includes(request.status)) {
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

    // Cho phép hủy: pending, pending_otp, pending_payment
    const cancellableStatuses = ['pending', 'pending_otp', 'pending_payment'];
    if (!cancellableStatuses.includes(request.status)) {
      throw new Error(`Không thể hủy yêu cầu có trạng thái "${request.status}"`);
    }

    if (userId && request.requested_by !== userId) {
      throw new Error('Bạn không có quyền hủy yêu cầu này');
    }

    // Cancel associated payment if exists
    if (request.payment_code) {
      await client.query(`
        UPDATE payments 
        SET status = 'CANCELLED', updated_at = NOW() 
        WHERE payment_code = $1 AND status NOT IN ('SUCCESS', 'PAID', 'COMPLETED')
      `, [request.payment_code]);
      console.log(`[DateChange Cancel] Cancelled payment: ${request.payment_code}`);
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

const getAdminDateChanges = async (status = '', page = 1, limit = 15) => {
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const values = [];
  let idx = 1;

  let whereClause = '';
  if (status) {
    whereClause = `WHERE dcr.status = $${idx++}`;
    values.push(status);
  }

  const countValues = status ? [status] : [];
  const countWhere  = status ? `WHERE dcr.status = $1` : '';

  const [dataResult, countResult] = await Promise.all([
    pool.query(QCD.SELECT_DATE_CHANGES_ADMIN(whereClause, idx, idx + 1), [...values, parseInt(limit), offset]),
    pool.query(QCD.COUNT_DATE_CHANGES_ADMIN(countWhere), countValues),
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
  createDateChangePayment,
  confirmDateChangePayment,
  getDateChangePaymentStatus,
  cancelDateChangePayment,

};