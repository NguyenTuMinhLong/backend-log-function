'use strict';

// DATE CHANGE SERVICE - Đổi ngày bay

const pool = require('../config/db');
const QCD = require('../queries/date-change.queries');
const QB = require('../queries/booking.queries');
const QF = require('../queries/flight.queries');
const QR = require('../queries/refund.queries');
const QP = require('../queries/payment.queries');
const { DATE_CHANGE } = require('../config/refund.config');
const { createDateChangeNotification } = require('./notification.service');
const { sendRefundOTPEmail, sendBookingConfirmedEmail } = require('../utils/mailer');
const { OTP_CONFIG } = require('../config/refund.config');
const { buildPaymentInstruction } = require('../utils/formatters');
const paymentConfig = require('../config/payment.config');
const { applyDynamicPricingWithSeason } = require('../utils/pricing');

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
  return `REF-${date}-${s}`; // varchar(20): "REF-" + 8 + "-" + 6 = 19
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

const DATE_CHANGE_LEGS = ['outbound'];

const ACTIVE_DATE_CHANGE_STATUSES = ['pending_otp', 'pending_payment', 'pending'];

const toPassengerCount = (booking, passengerIds = null) => {
  if (Array.isArray(passengerIds) && passengerIds.length > 0) {
    return passengerIds.length;
  }

  return [booking.total_adults, booking.total_children, booking.total_infants]
    .map((value) => parseInt(value || 0, 10))
    .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
};

const normalizeFlightLeg = (flightLeg) => {
  const normalized = String(flightLeg || 'outbound').trim().toLowerCase();
  if (!DATE_CHANGE_LEGS.includes(normalized)) {
    throw new Error(`flight_leg phai la mot trong: ${DATE_CHANGE_LEGS.join(', ')}`);
  }
  return normalized;
};

const validateLegEligibility = (booking, flightLeg) => {
  if (flightLeg === 'outbound') {
    return {
      flightId: booking.outbound_flight_id,
      seatClass: booking.outbound_seat_class,
      departureTime: booking.outbound_departure_time,
      basePrice: parseFloat(booking.base_price || 0),
      currentFlightNumber: booking.outbound_flight_number,
    };
  }

  throw new Error(`Date change V1 chua ho tro leg "${flightLeg}"`);
};

const getApprovedDateChangeCountForLeg = async (bookingId, flightLeg, db = pool) => {
  const result = await db.query(QCD.COUNT_APPROVED_DATE_CHANGES_FOR_LEG, [bookingId, flightLeg]);
  return parseInt(result.rows[0]?.count || 0, 10);
};

const validateApprovedDateChangeLimit = async (bookingId, flightLeg, db = pool) => {
  const approvedCount = await getApprovedDateChangeCountForLeg(bookingId, flightLeg, db);
  const limit = DATE_CHANGE.limits?.maxApprovedChangesPerLeg || 2;

  if (approvedCount >= limit) {
    throw new Error(`Leg ${flightLeg} da dat toi da ${limit} lan doi ngay duoc duyet`);
  }

  return approvedCount;
};

const ensureRequestStatus = (request, allowedStatuses, actionLabel) => {
  if (!allowedStatuses.includes(request.status)) {
    throw new Error(`${actionLabel} khong hop le cho yeu cau o trang thai "${request.status}"`);
  }
};

const markDateChangeRequestAsPending = async (db, requestCode) => {
  const result = await db.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, ['pending', requestCode]);
  return result.rows[0] || null;
};

// HELPERS
const validateDateChangeRequest = async (booking, newFlightId, seatClass, flightLeg = 'outbound') => {
  const legContext = validateLegEligibility(booking, flightLeg);

  // 1. Booking phải confirmed
  if (booking.status !== 'confirmed') {
    throw new Error(`Không thể đổi ngày bay cho booking có trạng thái "${booking.status}"`);
  }

  // 2. Check thời gian trước departure
  const hoursUntilDeparture = (new Date(legContext.departureTime) - new Date()) / (1000 * 60 * 60);
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
    const currentDeparture = new Date(legContext.departureTime);
    const newDeparture = new Date(newFlight.departure_time);
    const daysDiff = Math.abs((newDeparture - currentDeparture) / (1000 * 60 * 60 * 24));
    if (daysDiff > DATE_CHANGE.maxDateRange) {
      throw new Error(`Không thể đổi sang ngày cách hơn ${DATE_CHANGE.maxDateRange} ngày`);
    }
  }

  return {
    ...newFlight,
    current_leg_context: legContext,
  };
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
const verifyDateChangeOTP = async (email, otp, requestCode) => {
  const normalizedEmail = String(email || '').toLowerCase().trim();

  const { rows } = await pool.query(
    `SELECT request_code, otp_code, otp_expires_at, otp_attempts, booking_id
     FROM date_change_requests
     WHERE request_code = $1
     LIMIT 1`,
    [requestCode]
  );

  if (rows.length === 0) throw new Error('Khong tim thay yeu cau doi ngay bay');

  const otpData = rows[0];
  if (!otpData.otp_code) throw new Error('Khong tim thay ma OTP');
  if (new Date() > new Date(otpData.otp_expires_at)) throw new Error('Ma OTP da het han');
  if ((otpData.otp_attempts || 0) >= OTP_CONFIG.maxAttempts) throw new Error('Qua so lan thu');

  const bookingResult = await pool.query(
    `SELECT contact_email FROM bookings WHERE id = $1 LIMIT 1`,
    [otpData.booking_id]
  );

  const bookingEmail = String(bookingResult.rows[0]?.contact_email || '').toLowerCase().trim();
  if (!bookingEmail || bookingEmail !== normalizedEmail) {
    throw new Error('Email xac thuc khong hop le');
  }

  if (otpData.otp_code !== otp) {
    await pool.query(
      `UPDATE date_change_requests
       SET otp_attempts = COALESCE(otp_attempts, 0) + 1
       WHERE request_code = $1`,
      [requestCode]
    );
    throw new Error('Ma OTP khong dung');
  }

  await pool.query(
    `UPDATE date_change_requests
     SET otp_attempts = 0
     WHERE request_code = $1`,
    [requestCode]
  );

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
    flight_leg = 'outbound',
  } = data;

  if (!new_flight_id) throw new Error('new_flight_id là bắt buộc');
  if (!new_seat_class) throw new Error('new_seat_class là bắt buộc');
  const normalizedFlightLeg = normalizeFlightLeg(flight_leg);
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

    const existingRequest = await client.query(QCD.CHECK_PENDING_DATE_CHANGE_FOR_BOOKING, [booking.id, normalizedFlightLeg]);
    if (existingRequest.rows.length > 0) {
      throw new Error(`Đã có yêu cầu đổi ngày đang chờ xử lý cho leg ${normalizedFlightLeg}`);
    }

    const legContext = validateLegEligibility(booking, normalizedFlightLeg);
    await validateApprovedDateChangeLimit(booking.id, normalizedFlightLeg, client);

    const newFlight = await validateDateChangeRequest(booking, new_flight_id, new_seat_class, normalizedFlightLeg);

    // Check seat availability
    if (DATE_CHANGE.checkSeatAvailability) {
      const passengers = toPassengerCount(booking, passenger_ids);
      if (newFlight.available_seats < passengers) {
        throw new Error(`Chuyến bay mới không đủ ghế. Còn ${newFlight.available_seats} ghế, cần ${passengers}`);
      }
    }

    const seatsNeeded = toPassengerCount(booking, passenger_ids);
    // newFlight.base_price là giá thô flight_seats — phải áp dynamic pricing (mùa/ngày/nhu cầu)
    // giống lúc tạo booking, nếu không phụ phí/hoàn tiền đổi ngày sẽ tính sai
    const newFlightPrice = await applyDynamicPricingWithSeason(
      parseFloat(newFlight.base_price), newFlight.available_seats, newFlight.total_seats, newFlight.departure_time,
    );
    const newTotalPrice = newFlightPrice * seatsNeeded;
    const oldPrice = parseFloat(legContext.basePrice) * seatsNeeded;
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
      legContext.flightId,
      new_flight_id,
      legContext.seatClass,
      new_seat_class,
      passenger_ids ? JSON.stringify(passenger_ids) : null,
      oldPrice,
      newTotalPrice,
      priceDifference,
      'pending_otp', // Status: cho OTP verification
      reason,
      userId,
      normalizedFlightLeg,
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
        flight_leg: normalizedFlightLeg,
        flight_id: legContext.flightId,
        flight_number: legContext.currentFlightNumber,
        departure_time: legContext.departureTime,
        seat_class: legContext.seatClass,
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
      requires_otp: true,
      next_action: 'verify_otp',
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

  ensureRequestStatus(request, ['pending_otp'], 'Xac thuc OTP');

  const requiresPayment = parseFloat(request.price_difference) > 0 && DATE_CHANGE.priceDifference?.chargeIfPositive;

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
  const absDiff = Math.abs(parseFloat(request.price_difference) || 0);
  const autoApprove = AUTO_REFUND.enabled && absDiff < AUTO_REFUND.threshold;

  // Fix Bug 2: luôn set 'pending' trước — approveDateChange yêu cầu status = 'pending'
  await pool.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, ['pending', requestCode]);

  if (autoApprove) {
    await approveDateChange(null, requestCode, 'Auto-approved');
  }


  return {
    success: true,
    status: 'pending',
    auto_approved: autoApprove,
    requires_payment: false,
    message: autoApprove
      ? 'Yêu cầu đổi ngày bay đã được tự động duyệt.'
      : 'Yêu cầu đổi ngày bay đã được tiếp nhận và đang chờ admin xử lý.',
    next_action: autoApprove ? 'completed' : 'wait_for_admin',
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

    ensureRequestStatus(request, ['pending_payment'], 'Tao thanh toan');

    if (request.price_difference <= 0) {
      throw new Error('Yeu cau nay khong can thanh toan them');
    }

    // 3. Check if payment already exists (with lock held)
    if (request.payment_id && request.payment_code) {
      const existingPayment = await getDateChangePaymentByCodeRow(request.payment_code);
      const existingGatewayResponse = existingPayment?.gateway_response || {};
      const isReusablePendingPayment =
        existingPayment &&
        !isTerminalPaidStatus(existingPayment.status) &&
        (
          normalizedMethod !== 'PAYPAL' ||
          String(existingPayment.payment_method || '').toUpperCase() !== 'PAYPAL' ||
          Boolean(existingGatewayResponse.approve_url || existingGatewayResponse.redirect_url || existingGatewayResponse.order_id)
        );

      if (isReusablePendingPayment) {
        await client.query('COMMIT');
        return {
          ...mapDateChangePayment(existingPayment),
          request_code: requestCode,
          price_difference: parseFloat(request.price_difference),
        };
      }

      if (existingPayment && !isTerminalPaidStatus(existingPayment.status)) {
        await client.query(`
          UPDATE payments
          SET status = 'FAILED',
              updated_at = NOW(),
              gateway_response = COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object(
                'provider_retry_required', true,
                'provider_retry_reason', 'missing_checkout_url',
                'invalidated_at', NOW()
              )
          WHERE id = $1
        `, [existingPayment.id]);
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

// FINALIZE DATE CHANGE SAU KHI PAYMENT PHỤ THU ĐÃ THÀNH CÔNG
// Dùng chung cho: webhook BANK/MOMO/PAYOS (qua confirmDateChangePayment)
// và PayPal return (payment đã được confirm qua paymentService.handlePaypalReturn)
// Idempotent: nếu request không còn ở 'pending_payment' thì coi như đã xử lý.
const finalizeApprovedDateChangePayment = async (paymentCode) => {
  const requestResult = await pool.query(QCD.SELECT_DATE_CHANGE_BY_PAYMENT_CODE, [paymentCode]);
  if (requestResult.rows.length === 0) return null;
  const request = requestResult.rows[0];

  if (request.status !== 'pending_payment') {
    return { already_processed: true, status: request.status, request_code: request.request_code };
  }

  // Set status='pending' trước để approveDateChange có thể chạy
  // (approveDateChange yêu cầu status='pending', không được set 'approved' trước)
  await pool.query(QCD.UPDATE_DATE_CHANGE_STATUS_SIMPLE, ['pending', request.request_code]);

  // Execute the actual date change (release old seats, reserve new seats, update booking)
  await approveDateChange(null, request.request_code, 'Payment confirmed');

  // Mark paid_at
  await pool.query(`UPDATE date_change_requests SET paid_at = NOW() WHERE request_code = $1`, [request.request_code]);

  return { success: true, status: 'approved', request_code: request.request_code };
};

// CONFIRM DATE CHANGE PAYMENT (After payment success)

const confirmDateChangePayment = async (paymentCode, options = {}) => {
  const { trustedPaid = false, gatewayPayload = null } = options;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const paymentResult = await client.query(
      'SELECT * FROM payments WHERE payment_code = $1 LIMIT 1 FOR UPDATE',
      [paymentCode]
    );
    const payment = paymentResult.rows[0];
    if (!payment) throw new Error('Khong tim thay thanh toan');

    const requestResult = await client.query(QCD.SELECT_DATE_CHANGE_BY_PAYMENT_CODE, [paymentCode]);
    if (requestResult.rows.length === 0) throw new Error('Khong tim thay yeu cau doi ngay bay');
    const request = requestResult.rows[0];

    if (isTerminalPaidStatus(payment.status)) {
      const normalizedRequestStatus = request.status === 'approved' ? 'approved' : 'pending';
      await client.query('COMMIT');
      return {
        success: true,
        already_processed: true,
        request_code: request.request_code,
        status: normalizedRequestStatus,
        payment_status: 'SUCCESS',
        message: normalizedRequestStatus === 'approved'
          ? 'Thanh toan da duoc ghi nhan va yeu cau da duoc duyet truoc do.'
          : 'Thanh toan da duoc ghi nhan. Yeu cau dang cho admin xu ly.',
      };
    }

    ensureRequestStatus(request, ['pending_payment'], 'Xac nhan thanh toan');

    if (payment.expires_at && new Date() > new Date(payment.expires_at)) {
      await client.query(
        `UPDATE payments SET status = 'EXPIRED', updated_at = NOW() WHERE payment_code = $1`,
        [paymentCode]
      );
      throw new Error('Payment da het han. Vui long tao thanh toan moi.');
    }

    const expectedAmount = parseFloat(request.price_difference);
    const receivedAmount = parseFloat(payment.amount);
    if (receivedAmount !== expectedAmount) {
      throw new Error(`So tien khong dung. Expected: ${expectedAmount}, Received: ${receivedAmount}`);
    }

  // 5. Update payment to SUCCESS (dùng client để tránh deadlock với lock FOR UPDATE đang giữ)
  await client.query(`
    UPDATE payments
    SET status = 'SUCCESS', paid_at = NOW(), updated_at = NOW()
    WHERE payment_code = $1
  `, [paymentCode]);

  await client.query('COMMIT');

  // 6-8. Hoàn tất approve date change (đặt ghế mới, cập nhật booking, gửi email...)
  await finalizeApprovedDateChangePayment(paymentCode);

    return {
      success: true,
      request_code: request.request_code,
      status: 'pending',
      payment_status: 'SUCCESS',
      next_action: 'wait_for_admin',
      message: 'Thanh toan thanh cong. Yeu cau doi ngay bay dang cho admin xu ly.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
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

    const requestResult = await client.query(
      `${QCD.SELECT_DATE_CHANGE_BY_CODE.trim()} FOR UPDATE OF dcr`,
      [requestCode]
    );
    if (requestResult.rows.length === 0) throw new Error('Không tìm thấy yêu cầu đổi ngày bay');

    const request = requestResult.rows[0];
    console.log(`[DateChange Approve] Request: ${requestCode}, Status: ${request.status}`);

    ensureRequestStatus(request, ['pending'], 'Duyet yeu cau');
    await validateApprovedDateChangeLimit(request.booking_id, request.flight_leg || 'outbound', client);

    // passenger_ids là cột JSONB, driver pg đã tự parse sẵn thành array/null
    let passengers = Array.isArray(request.passenger_ids) ? request.passenger_ids.length : 0;

    if (!passengers) {
      const bookingPassengerResult = await client.query(
        'SELECT total_adults, total_children, total_infants FROM bookings WHERE id = $1 LIMIT 1',
        [request.booking_id]
      );
      const bookingPassengerRow = bookingPassengerResult.rows[0] || {};
      passengers = [bookingPassengerRow.total_adults, bookingPassengerRow.total_children, bookingPassengerRow.total_infants]
        .map((value) => parseInt(value || 0, 10))
        .reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
    }

    if (!passengers) {
      throw new Error('Khong xac dinh duoc so hanh khach cho yeu cau doi ngay bay');
    }

    const newSeatCheck = await client.query(
      'SELECT available_seats, total_seats FROM flight_seats WHERE flight_id = $1 AND class = $2 FOR UPDATE',
      [request.new_flight_id, request.new_seat_class]
    );

    if (newSeatCheck.rows.length === 0) throw new Error('Không tìm thấy ghế chuyến bay mới');

    const newSeat = newSeatCheck.rows[0];
    console.log(`[New Flight] Available: ${newSeat.available_seats}/${newSeat.total_seats}`);

    if (newSeat.available_seats < passengers) {
      throw new Error(`Chuyến bay mới chỉ còn ${newSeat.available_seats} ghế`);
    }

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
    await client.query(
      `UPDATE bookings SET status = 'date_changed', updated_at = NOW() WHERE id = $1`,
      [request.booking_id]
    );

    // Cập nhật final_amount của payment gốc = tổng tiền mới (bao gồm surcharge)
    await client.query(`
      UPDATE payments
      SET final_amount = $1, updated_at = NOW()
      WHERE id = (
        SELECT id FROM payments
        WHERE booking_id = $2
          AND payment_code NOT LIKE 'PAY-DC-%'
          AND status IN ('SUCCESS', 'PAID', 'COMPLETED', 'CONFIRMED')
        ORDER BY created_at ASC
        LIMIT 1
      )
    `, [updatedBookingTotal, request.booking_id]);

    await client.query(QCD.UPDATE_DATE_CHANGE_STATUS, [
      'approved',
      adminId,
      adminNotes,
      requestCode,
    ]);

    await client.query('COMMIT');
    console.log(`[DateChange Approve] SUCCESS: ${requestCode}`);

    // Gửi thông báo + email xác nhận sau khi COMMIT
    try {
      await createDateChangeNotification({
        event: 'DATE_CHANGE_APPROVED',
        request: { ...request, status: 'approved', admin_notes: finalAdminNotes },
        booking: { booking_code: request.booking_code },
        adminId,
      });
    } catch (notifErr) {
      console.error('[DateChange] Approval notification error:', notifErr.message);
    }

    const toEmail = request.contact_email || request.user_email;
    if (toEmail) {
      try {
        // Lấy phương thức thanh toán thực tế của khoản phụ thu (nếu có)
        let actualPaymentMethod = null;
        if (request.payment_id) {
          const payRes = await pool.query(
            `SELECT payment_method FROM payments WHERE id = $1`,
            [request.payment_id]
          );
          actualPaymentMethod = payRes.rows[0]?.payment_method || null;
        }

        // Lấy danh sách hành khách của booking để hiển thị trong email
        const passRes = await pool.query(
          `SELECT full_name, passenger_type, seat_number, baggage_kg, flight_type
           FROM passengers WHERE booking_id = $1
           ORDER BY flight_type, passenger_type`,
          [request.booking_id]
        );

        await sendBookingConfirmedEmail(toEmail, {
          bookingCode: request.booking_code,
          contactName: request.contact_name || request.user_name || 'Quý khách',
          finalAmount: updatedBookingTotal,
          surchargeAmount,
          paymentMethod: actualPaymentMethod,
          paidAt: new Date().toISOString(),
          isDateChange: true,
          booking: {
            outbound_flight_number: request.new_flight_number,
            outbound_airline_name: request.new_airline_name,
            outbound_departure_time: request.new_departure_time,
            outbound_arrival_time: request.new_arrival_time,
            outbound_dep_code: request.new_departure_code,
            outbound_dep_city: request.new_departure_city,
            outbound_arr_code: request.new_arrival_code,
            outbound_arr_city: request.new_arrival_city,
            outbound_seat_class: request.new_seat_class,
          },
          passengers: passRes.rows,
        });
      } catch (mailErr) {
        console.error('[DateChange] Approval email error:', mailErr.message);
      }
    }

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

    // Cho phép reject các yêu cầu chưa hoàn tất xử lý cuối cùng
    if (!ACTIVE_DATE_CHANGE_STATUSES.includes(request.status)) {
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
      'User cancelled',
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
  finalizeApprovedDateChangePayment,
  getDateChangePaymentStatus,
  cancelDateChangePayment,
  getAdminDateChanges,

};