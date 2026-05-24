/**
 * Payment Service - Tích hợp đa cổng thanh toán
 * Hỗ trợ: BANK_QR (VietQR), PayOS, MoMo, PayPal
 */

const pool = require("../config/db");
const QP = require("../queries/payment.queries");
const QC = require("../queries/coupon.queries");
const config = require("../config/payment.config");
const { buildPaymentInstruction } = require("../utils/formatters");

// Import providers
const { createBankQrInstruction } = require("../providers/bankqr.provider");
const {
  createMomoPaymentInstruction,
  verifyMomoCallbackSignature,
  inferPaymentCode,
  normalizeAmount,
  isMomoCancelResult,
} = require("../providers/momo.provider");
const {
  createPayPalOrder,
  capturePayPalOrder,
  getFrontendResultBaseUrl,
} = require("../providers/paypal.provider");
const {
  createPayosPaymentInstruction,
  verifyPayosWebhookData,
  getPayosPaymentLink,
  cancelPayosPaymentLink,
} = require("../providers/payos.provider");

const VALID_PAYMENT_METHODS = ["BANK_QR", "BANK_TRANSFER", "MOMO", "PAYPAL"];

const normalizeVoucherCode = (code) => {
  if (!code || typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  return normalized || null;
};

const generatePaymentCode = () => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `PAY-${timestamp}-${random}`;
};

const toNumber = (value) => Number(value || 0);

// ── Helpers ───────────────────────────────────────────────────────────────────

const isTerminalPaidStatus = (status) =>
  ['PAID', 'SUCCESS', 'COMPLETED', 'CONFIRMED'].includes(String(status || '').toUpperCase());

const isTerminalCancelledStatus = (status) =>
  ['CANCELLED', 'FAILED', 'VOID', 'EXPIRED'].includes(String(status || '').toUpperCase());

const getPaymentChargeAmount = (payment) =>
  Number(payment?.final_amount ?? payment?.amount ?? 0);

const mapPayment = (payment, providerPayload = {}) => ({
  ...payment,
  method: payment.payment_method,
  instruction: buildPaymentInstruction({
    payment,
    providerPayload,
    bankConfig: config.bankQr,
    payosConfig: config.payos,
    momoConfig: config.momo,
    paypalConfig: config.paypal,
  }),
});

const buildPaymentResponse = (payment, bookingCode) => ({
  id: payment.id,
  payment_code: payment.payment_code,
  booking_id: payment.booking_id,
  booking_code: bookingCode,
  payment_method: payment.payment_method,
  amount: toNumber(payment.amount),
  discount_amount: toNumber(payment.discount_amount),
  final_amount: toNumber(payment.final_amount),
  voucher_id: payment.voucher_id || null,
  voucher_code: payment.voucher_code || null,
  status: payment.status,
  expires_at: payment.expires_at || null,
  paid_at: payment.paid_at || null,
  created_at: payment.created_at || null,
  gateway_response: payment.gateway_response || null,
});

const PAYMENT_WITH_BOOKING_CODE = `
  SELECT p.*, b.booking_code
  FROM payments p
  LEFT JOIN bookings b ON b.id = p.booking_id
`;

const getPaymentByCodeRow = async (paymentCode) => {
  const { rows } = await pool.query(
    `${PAYMENT_WITH_BOOKING_CODE} WHERE p.payment_code = $1 LIMIT 1`,
    [paymentCode]
  );
  return rows[0] || null;
};

const getPaymentByIdRow = async (id) => {
  const { rows } = await pool.query(
    `${PAYMENT_WITH_BOOKING_CODE} WHERE p.id::text = $1 LIMIT 1`,
    [String(id)]
  );
  return rows[0] || null;
};

const getPaymentByGatewayOrderId = async (orderId) => {
  const { rows } = await pool.query(
    `${PAYMENT_WITH_BOOKING_CODE}
     WHERE p.gateway_response ->> 'order_id' = $1
     ORDER BY p.created_at DESC LIMIT 1`,
    [orderId]
  );
  return rows[0] || null;
};

const updatePaymentProviderFields = async (paymentCode, fields = {}) => {
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

const getBookingForPayment = async (client, bookingCode, userId, lockRow = false) => {
  const result = await client.query(QP.SELECT_BOOKING_FOR_PAYMENT(lockRow), [bookingCode]);

  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

  const booking = result.rows[0];

  if (booking.user_id && !userId) throw new Error("Bạn cần đăng nhập để thanh toán booking này");
  if (booking.user_id && userId && Number(booking.user_id) !== Number(userId)) {
    throw new Error("Bạn không có quyền thao tác với booking này");
  }

  // Cộng thêm ancillary total vào total_price để tính đúng số tiền cần thanh toán
  const ancResult = await client.query(
    `SELECT COALESCE(SUM(total_price), 0) AS ancillary_total
     FROM booking_ancillaries
     WHERE booking_id = $1 AND status != 'cancelled'`,
    [booking.id]
  );
  const ancillaryTotal = parseFloat(ancResult.rows[0].ancillary_total || 0);
  booking.ticket_price  = parseFloat(booking.total_price);
  booking.total_price   = booking.ticket_price + ancillaryTotal;

  return booking;
};

const ensureBookingPayable = (booking) => {
  if (booking.status === "cancelled") throw new Error("Booking này đã bị hủy");
  if (booking.status === "expired") throw new Error("Booking này đã hết hạn");
  if (booking.status === "confirmed") throw new Error("Booking này đã thanh toán");
  if (booking.status !== "pending") throw new Error(`Không thể thanh toán booking ở trạng thái ${booking.status}`);
  if (booking.held_until && new Date(booking.held_until) < new Date()) {
    throw new Error("Booking đã quá thời gian giữ chỗ");
  }
};

const getVoucherQuote = async (client, booking, userId, voucherCode) => {
  const normalizedCode = normalizeVoucherCode(voucherCode);

  if (!normalizedCode) {
    return { voucher: null, discountAmount: 0, finalAmount: toNumber(booking.total_price) };
  }

  const voucherResult = await client.query(QC.SELECT_VOUCHER_BY_CODE, [normalizedCode]);
  if (voucherResult.rows.length === 0) throw new Error("Voucher không tồn tại");

  const voucher = voucherResult.rows[0];
  const totalPrice = toNumber(booking.total_price);

  if (!voucher.is_active) throw new Error("Voucher đã bị vô hiệu hóa");
  if (voucher.start_at && new Date(voucher.start_at) > new Date()) throw new Error("Voucher chưa đến thời gian sử dụng");
  if (voucher.expiry_at && new Date(voucher.expiry_at) < new Date()) throw new Error("Voucher đã hết hạn");
  if (voucher.airline_id && Number(voucher.airline_id) !== Number(booking.outbound_airline_id)) {
    throw new Error("Voucher không áp dụng cho hãng bay của booking này");
  }
  if (totalPrice < toNumber(voucher.min_order)) {
    throw new Error(`Đơn hàng chưa đạt giá trị tối thiểu ${toNumber(voucher.min_order)}`);
  }

  const usageCountResult = await client.query(QC.SELECT_COUPON_USAGE_COUNTS, [voucher.id]);
  const reservedCount = Number(usageCountResult.rows[0].reserved_count || 0);
  const usedUsageCount = Number(usageCountResult.rows[0].used_count || 0);
  const occupiedCount = Math.max(toNumber(voucher.used_count), usedUsageCount) + reservedCount;

  if (voucher.usage_limit !== null && occupiedCount >= Number(voucher.usage_limit)) {
    throw new Error("Voucher đã hết lượt sử dụng");
  }

  if (voucher.usage_limit_per_user !== null) {
    if (!userId) throw new Error("Voucher này yêu cầu đăng nhập để kiểm tra giới hạn sử dụng");
    const perUserResult = await client.query(QC.SELECT_COUPON_USAGE_PER_USER, [voucher.id, userId]);
    if (Number(perUserResult.rows[0].total || 0) >= Number(voucher.usage_limit_per_user)) {
      throw new Error("Bạn đã sử dụng hết số lượt cho voucher này");
    }
  }

  if (voucher.welcome_only) {
    if (!userId) throw new Error("Voucher welcome_only yêu cầu đăng nhập");
    const welcomeResult = await client.query(QC.SELECT_WELCOME_ONLY_CHECK, [userId]);
    const welcomeState = welcomeResult.rows[0];
    if (welcomeState.has_confirmed_booking || welcomeState.has_success_payment) {
      throw new Error("Voucher này chỉ áp dụng cho người dùng mới");
    }
  }

  let discountAmount = 0;
  if (voucher.type === "fixed") {
    discountAmount = Math.min(totalPrice, toNumber(voucher.value));
  } else if (voucher.type === "percent") {
    discountAmount = Math.round((totalPrice * toNumber(voucher.value)) / 100);
    if (voucher.max_discount !== null) {
      discountAmount = Math.min(discountAmount, toNumber(voucher.max_discount));
    }
  }

  return { voucher, discountAmount, finalAmount: Math.max(totalPrice - discountAmount, 0) };
};

const rollbackReservedVoucherUsageForBooking = async (client, bookingId) => {
  await client.query(QC.ROLLBACK_RESERVED_COUPON_USAGE, [bookingId]);
};

// ── Preview Payment ───────────────────────────────────────────────────────────

const previewPayment = async (data, userId = null) => {
  const bookingCode = String(data.booking_code || "").trim().toUpperCase();
  if (!bookingCode) throw new Error("booking_code là bắt buộc");

  const client = await pool.connect();
  try {
    const booking = await getBookingForPayment(client, bookingCode, userId, false);
    ensureBookingPayable(booking);
    const quote = await getVoucherQuote(client, booking, userId, data.voucher_code);

    return {
      booking_id: booking.id,
      booking_code: booking.booking_code,
      amount: toNumber(booking.total_price),
      discount_amount: quote.discountAmount,
      final_amount: quote.finalAmount,
      voucher: quote.voucher
        ? {
            id: quote.voucher.id,
            code: quote.voucher.code,
            type: quote.voucher.type,
            value: toNumber(quote.voucher.value),
            max_discount: quote.voucher.max_discount !== null ? toNumber(quote.voucher.max_discount) : null,
          }
        : null,
    };
  } finally {
    client.release();
  }
};

// ── Create Payment ────────────────────────────────────────────────────────────

const createPayment = async (data, userId = null) => {
  const bookingCode = String(data.booking_code || "").trim().toUpperCase();
  const paymentMethod = String(data.payment_method || "").trim().toUpperCase();

  if (!bookingCode) throw new Error("booking_code là bắt buộc");
  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`payment_method phải là: ${VALID_PAYMENT_METHODS.join(", ")}`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const booking = await getBookingForPayment(client, bookingCode, userId, true);
    ensureBookingPayable(booking);

    const paidResult = await client.query(QP.FIND_SUCCESS_PAYMENT_BY_BOOKING, [booking.id]);
    if (paidResult.rows.length > 0) throw new Error("Booking này đã có thanh toán thành công");

    await client.query(QP.CANCEL_PENDING_PAYMENTS, [booking.id]);
    await rollbackReservedVoucherUsageForBooking(client, booking.id);

    const quote = await getVoucherQuote(client, booking, userId, data.voucher_code);
    const paymentCode = generatePaymentCode();

    const paymentResult = await client.query(QP.INSERT_PAYMENT, [
      booking.id,
      booking.user_id || userId || null,
      paymentCode,
      paymentMethod,
      toNumber(booking.total_price),
      quote.discountAmount,
      quote.finalAmount,
      quote.voucher ? quote.voucher.id : null,
      quote.voucher ? quote.voucher.code : null,
      booking.held_until || null,
    ]);

    if (quote.voucher) {
      await client.query(QC.INSERT_COUPON_USAGE, [
        quote.voucher.id,
        booking.user_id || userId || null,
        booking.id,
        quote.discountAmount,
      ]);
    }

    await client.query("COMMIT");
    return buildPaymentResponse(paymentResult.rows[0], booking.booking_code);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ── Init Payment (với gateway integration) ─────────────────────────────────────

const initPayment = async ({ booking_code, payment_method, voucher_code, userId }) => {
  // Tạo payment record
  const payment = await createPayment({ booking_code, payment_method, voucher_code }, userId);
  
  // Nếu amount = 0, tự động confirm
  if (getPaymentChargeAmount(payment) <= 0) {
    return confirmPayment(payment.payment_code, userId);
  }

  let providerPayload = {};

  // ── BANK_QR ────────────────────────────────────────────────────────────────
  if (payment_method === 'BANK_QR') {
    if (config.payos.enabled) {
      const existingGw = payment.gateway_response || {};
      if (existingGw.provider === 'PAYOS' && existingGw.checkout_url) {
        providerPayload = existingGw;
      } else {
        providerPayload = await createPayosPaymentInstruction(payment);
        const updated = await updatePaymentProviderFields(payment.payment_code, {
          qr_payload: providerPayload.qr_payload,
          bank_code: providerPayload.bank_bin,
          bank_account: providerPayload.bank_account,
          transfer_content: providerPayload.description || payment.payment_code,
          gateway_response: {
            ...providerPayload,
            provider: 'PAYOS',
            mode: 'hosted_checkout',
            generatedAt: new Date().toISOString(),
          },
        });
        if (updated) {
          payment.gateway_response = updated.gateway_response;
          payment.qr_payload = updated.qr_payload;
        }
      }
    } else {
      providerPayload = createBankQrInstruction(payment);
      await updatePaymentProviderFields(payment.payment_code, {
        qr_payload: providerPayload.qr_payload,
        bank_code: providerPayload.bank_code,
        bank_account: providerPayload.bank_account,
        transfer_content: providerPayload.transfer_content,
        gateway_response: {
          provider: 'BANK_QR',
          generatedAt: new Date().toISOString(),
          mode: 'reconciliation_ready',
        },
      });
    }
  }

  // ── MOMO ───────────────────────────────────────────────────────────────────
  if (payment_method === 'MOMO') {
    if (!config.momo.enabled) {
      throw new Error('MoMo payment is not configured on this server');
    }

    const existingGw = payment.gateway_response || {};
    if (existingGw.provider === 'MOMO' && existingGw.pay_url) {
      providerPayload = existingGw;
    } else {
      providerPayload = await createMomoPaymentInstruction(payment);
      await updatePaymentProviderFields(payment.payment_code, {
        qr_payload: providerPayload.qr_payload,
        gateway_response: {
          ...providerPayload,
          provider: 'MOMO',
          mode: 'gateway_redirect',
          generatedAt: new Date().toISOString(),
        },
      });
    }
  }

  // ── PAYPAL ─────────────────────────────────────────────────────────────────
  if (payment_method === 'PAYPAL') {
    if (!config.paypal.enabled) {
      throw new Error('PayPal payment is not configured on this server');
    }

    const existingGw = payment.gateway_response || {};
    if (existingGw.provider === 'PAYPAL' && existingGw.order_id && existingGw.approve_url) {
      providerPayload = existingGw;
    } else {
      providerPayload = await createPayPalOrder(payment);
      await updatePaymentProviderFields(payment.payment_code, {
        gateway_response: {
          ...providerPayload,
          provider: 'PAYPAL',
          mode: 'redirect_checkout',
          generatedAt: new Date().toISOString(),
        },
      });
    }
  }

  // Fetch updated payment
  const updatedPayment = await getPaymentByCodeRow(payment.payment_code);
  return mapPayment(updatedPayment || payment, providerPayload);
};

// ── Confirm Payment ────────────────────────────────────────────────────────────

const confirmPayment = async (paymentCode, userId = null, bypassAuth = false) => {
  const normalizedPaymentCode = String(paymentCode || "").trim().toUpperCase();
  if (!normalizedPaymentCode) throw new Error("paymentCode là bắt buộc");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(QP.SELECT_PAYMENT_WITH_BOOKING, [normalizedPaymentCode]);
    if (result.rows.length === 0) throw new Error("Không tìm thấy payment");

    const payment = result.rows[0];

    if (!bypassAuth) {
      if (payment.booking_user_id && !userId) throw new Error("Bạn cần đăng nhập để xác nhận payment này");
      if (payment.booking_user_id && userId && Number(payment.booking_user_id) !== Number(userId)) {
        throw new Error("Bạn không có quyền thao tác payment này");
      }
    }

    if (payment.status === "SUCCESS") {
      await client.query("COMMIT");
      return buildPaymentResponse(payment, payment.booking_code);
    }

    if (payment.status !== "PENDING") {
      throw new Error(`Không thể xác nhận payment ở trạng thái ${payment.status}`);
    }

    const paymentUpdate = await client.query(QP.UPDATE_PAYMENT_SUCCESS, [payment.id]);
    await client.query(QP.CONFIRM_BOOKING_AFTER_PAYMENT, [payment.booking_id]);

    if (payment.voucher_id) {
      const usageResult = await client.query(QC.MARK_COUPON_USAGE_USED, [payment.booking_id, payment.voucher_id]);
      if (usageResult.rows.length > 0) {
        await client.query(QC.INCREMENT_COUPON_USED_COUNT, [payment.voucher_id]);
      }
    }

    await client.query("COMMIT");
    return buildPaymentResponse(paymentUpdate.rows[0], payment.booking_code);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ── Cancel Payment ─────────────────────────────────────────────────────────────

const cancelPayment = async ({ payment_code }) => {
  const payment = await getPaymentByCodeRow(payment_code);
  if (!payment) throw new Error("Không tìm thấy payment");
  if (isTerminalCancelledStatus(payment.status)) return mapPayment(payment);

  const gatewayResponse = payment.gateway_response || {};
  if (
    gatewayResponse.provider === 'PAYOS' &&
    gatewayResponse.order_code &&
    config.payos.enabled &&
    !isTerminalPaidStatus(payment.status)
  ) {
    await cancelPayosPaymentLink(gatewayResponse.order_code, 'Cancelled by backend').catch(() => null);
  }

  const { rows } = await pool.query("SELECT * FROM cancel_payment($1)", [payment_code]);
  return mapPayment(rows[0]);
};

// ── Get Payment by Code ────────────────────────────────────────────────────────

const getPaymentByCode = async (paymentCode) => {
  const payment = await getPaymentByCodeRow(paymentCode);
  if (!payment) throw new Error("Payment not found");
  return mapPayment(payment);
};

// ── Webhook Handlers ──────────────────────────────────────────────────────────

const handlePayosWebhook = async (payload = {}) => {
  const webhookData = await verifyPayosWebhookData(payload);
  const payment =
    await getPaymentByIdRow(webhookData.orderCode) ||
    await getPaymentByCodeRow(String(webhookData.description || '').trim());
  
  if (!payment) throw new Error("Payment not found");

  const expectedAmount = getPaymentChargeAmount(payment);
  const receivedAmount = Number(webhookData.amount || 0);

  if (receivedAmount !== expectedAmount) {
    throw new Error(`Amount mismatch. Expected ${expectedAmount} but received ${receivedAmount}`);
  }

  const isSuccessful =
    payload.success === true &&
    String(payload.code || webhookData.code || '').trim() === '00' &&
    String(webhookData.code || '').trim() === '00';

  if (isSuccessful) {
    if (isTerminalPaidStatus(payment.status)) return mapPayment(payment);

    return confirmPayment(payment.payment_code);
  }

  return mapPayment(payment);
};

const processMomoCallback = async (body = {}, source = 'ipn') => {
  const isValidSignature = verifyMomoCallbackSignature(body);
  if (!isValidSignature) {
    return { ok: false, resultCode: 13, message: 'Invalid signature', payment_code: inferPaymentCode(body) };
  }

  const paymentCode = inferPaymentCode(body);
  if (!paymentCode) {
    return { ok: false, resultCode: 42, message: 'Payment not found', payment_code: '' };
  }

  const payment = await getPaymentByCodeRow(paymentCode);
  if (!payment) {
    return { ok: false, resultCode: 42, message: 'Payment not found', payment_code: paymentCode };
  }

  const expectedAmount = normalizeAmount(getPaymentChargeAmount(payment));
  const receivedAmount = Number(body.amount || 0);
  
  if (expectedAmount !== receivedAmount) {
    if (!isTerminalCancelledStatus(payment.status) && !isTerminalPaidStatus(payment.status)) {
      await cancelPayment({ payment_code: paymentCode });
    }
    return { ok: false, resultCode: 1, message: 'Amount mismatch', payment_code: paymentCode };
  }

  const bookingCode = payment.booking_code || '';

  if (Number(body.resultCode) === 0) {
    if (isTerminalPaidStatus(payment.status)) {
      return { ok: true, resultCode: 0, message: 'Already processed', payment_code: paymentCode, booking_code: bookingCode };
    }
    await confirmPayment(paymentCode, null, true);
    return { ok: true, resultCode: 0, message: 'Success', payment_code: paymentCode, booking_code: bookingCode };
  }

  if (!isTerminalCancelledStatus(payment.status) && !isTerminalPaidStatus(payment.status)) {
    await cancelPayment({ payment_code: paymentCode });
  }
  return {
    ok: true,
    resultCode: 0,
    message: body.message || 'Received',
    payment_code: paymentCode,
    booking_code: bookingCode,
    return_status: isMomoCancelResult(body.resultCode, body.message) ? 'cancel' : 'error',
  };
};

const handleMomoIpn = async (body = {}) => {
  const result = await processMomoCallback(body, 'ipn');
  return { resultCode: result.resultCode, message: result.message };
};

const handleMomoReturn = async (query = {}) => {
  return processMomoCallback(query, 'redirect');
};

const handleBankWebhook = async ({ payment_code, amount, transfer_content, bank_transaction_id, status, bank_name, raw_payload }) => {
  const payment = await getPaymentByCodeRow(payment_code);
  if (!payment) throw new Error("Payment not found");
  if (isTerminalPaidStatus(payment.status)) return mapPayment(payment);

  const expectedAmount = getPaymentChargeAmount(payment);
  if (Number(amount) !== expectedAmount) {
    throw new Error(`Amount mismatch. Expected ${expectedAmount} but received ${amount}`);
  }

  const expectedContent = String(payment.transfer_content || payment.payment_code || '').trim();
  if (String(transfer_content || '').trim() !== expectedContent) {
    throw new Error("Transfer content mismatch");
  }

  if (String(status || 'success').toLowerCase() !== 'success') {
    throw new Error("Bank webhook status must be success");
  }

  return confirmPayment(payment.payment_code);
};

const handlePaypalReturn = async (query = {}) => {
  const orderId = String(query.token || query.orderId || '').trim();
  const paymentCode = String(query.payment_code || '').trim();

  if (!orderId) {
    return {
      status: 'error',
      message: 'Missing PayPal order token',
      payment_code: paymentCode,
    };
  }

  const payment =
    await getPaymentByGatewayOrderId(orderId) ||
    (paymentCode ? await getPaymentByCodeRow(paymentCode) : null);

  if (!payment) {
    return {
      status: 'error',
      message: 'Payment not found',
      payment_code: paymentCode,
      order_id: orderId,
    };
  }

  if (isTerminalPaidStatus(payment.status)) {
    return {
      status: 'success',
      message: 'Already processed',
      payment_code: payment.payment_code,
      order_id: orderId,
    };
  }

  const capture = await capturePayPalOrder(orderId);
  const purchaseUnit = Array.isArray(capture.purchase_units) ? capture.purchase_units[0] : null;
  const payments = purchaseUnit && purchaseUnit.payments ? purchaseUnit.payments : {};
  const captureItem = Array.isArray(payments.captures) ? payments.captures[0] : null;

  if (!captureItem || String(captureItem.status || '').toUpperCase() !== 'COMPLETED') {
    return {
      status: 'error',
      message: 'PayPal capture did not complete',
      payment_code: payment.payment_code,
      order_id: orderId,
    };
  }

  await confirmPayment(payment.payment_code, null, true);
  return {
    status: 'success',
    message: 'Success',
    payment_code: payment.payment_code,
    booking_code: payment.booking_code || '',
    order_id: orderId,
    capture_id: captureItem.id || '',
  };
};

const handlePaypalCancel = async (query = {}) => {
  const orderId = String(query.token || query.orderId || '').trim();
  const paymentCode = String(query.payment_code || '').trim();
  
  const payment =
    (orderId ? await getPaymentByGatewayOrderId(orderId) : null) ||
    (paymentCode ? await getPaymentByCodeRow(paymentCode) : null);

  let cancelledPayment = payment;
  if (payment && !isTerminalCancelledStatus(payment.status) && !isTerminalPaidStatus(payment.status)) {
    cancelledPayment = await cancelPayment({ payment_code: payment.payment_code });
  }

  return {
    status: 'cancel',
    message: 'Buyer cancelled PayPal checkout',
    payment_code: payment?.payment_code || paymentCode,
    booking_code: payment?.booking_code || '',
    order_id: orderId,
  };
};

// ── Checkout URL Getters ────────────────────────────────────────────────────────

const getPayosCheckoutUrl = async (paymentCode) => {
  const payment = await getPaymentByCodeRow(paymentCode);
  if (!payment) throw new Error("Payment not found");

  if (String(payment.payment_method).toUpperCase() !== 'BANK_QR') {
    throw new Error("payOS checkout is only enabled for BANK_QR payments");
  }

  if (isTerminalPaidStatus(payment.status)) {
    throw new Error("Payment has already been completed.");
  }

  if (isTerminalCancelledStatus(payment.status)) {
    throw new Error("Payment has expired or was cancelled. Please create a new booking and try again.");
  }

  const gatewayResp = payment.gateway_response || {};

  if (gatewayResp.provider === 'PAYOS' && gatewayResp.checkout_url) {
    return gatewayResp.checkout_url;
  }

  if (!config.payos.enabled) {
    throw new Error("payOS payment is not configured on this server");
  }

  const checkout = await createPayosPaymentInstruction(payment);
  await updatePaymentProviderFields(payment.payment_code, {
    qr_payload: checkout.qr_payload,
    bank_code: checkout.bank_bin,
    bank_account: checkout.bank_account,
    transfer_content: checkout.description || payment.payment_code,
    gateway_response: {
      ...gatewayResp,
      ...checkout,
      provider: 'PAYOS',
      mode: 'hosted_checkout',
      generatedAt: new Date().toISOString(),
    },
  }).catch(() => null);

  return checkout.checkout_url;
};

const getPaypalCheckoutUrl = async (paymentCode) => {
  const payment = await getPaymentByCodeRow(paymentCode);
  if (!payment) throw new Error("Payment not found");

  if (String(payment.payment_method).toUpperCase() !== 'PAYPAL') {
    throw new Error("PayPal checkout is only enabled for PAYPAL payments");
  }

  const gatewayResp = payment.gateway_response || {};

  if (gatewayResp.provider === 'PAYPAL' && gatewayResp.approve_url) {
    return gatewayResp.approve_url;
  }

  if (!config.paypal.enabled) {
    throw new Error("PayPal payment is not configured on this server");
  }

  const checkout = await createPayPalOrder(payment);
  await updatePaymentProviderFields(payment.payment_code, {
    gateway_response: {
      ...gatewayResp,
      ...checkout,
      provider: 'PAYPAL',
      mode: 'redirect_checkout',
      generatedAt: new Date().toISOString(),
    },
  }).catch(() => null);

  return checkout.approve_url;
};

// ── PayOS Return Handler ───────────────────────────────────────────────────────

const handlePayosReturn = async (returnStatus = 'success', query = {}) => {
  const paymentCode = String(query.payment_code || query.paymentCode || '').trim();
  const normalizedReturnStatus = String(returnStatus || '').toLowerCase();

  if (!paymentCode) {
    return { status: 'error', message: 'Missing payment code' };
  }

  const payment = await getPaymentByCodeRow(paymentCode);
  if (!payment) {
    return { status: 'error', message: 'Payment not found', payment_code: paymentCode };
  }

  const gatewayResp = payment.gateway_response || {};
  const orderCode = String(gatewayResp.order_code || query.orderCode || '');
  const paymentLinkId = String(gatewayResp.payment_link_id || query.id || '');

  const bookingCode = payment.booking_code || '';

  if (isTerminalPaidStatus(payment.status)) {
    return { status: 'success', message: 'Already processed', payment_code: payment.payment_code, booking_code: bookingCode };
  }

  if (normalizedReturnStatus === 'cancel') {
    const cancelledPayment = isTerminalCancelledStatus(payment.status)
      ? payment
      : await cancelPayment({ payment_code: payment.payment_code });
    return { status: 'cancel', message: 'Buyer cancelled payOS checkout', payment_code: payment.payment_code, booking_code: bookingCode };
  }

  if (!orderCode) {
    return { status: 'error', message: 'Missing payOS order code', payment_code: payment.payment_code, booking_code: bookingCode };
  }

  let paymentLink;
  try {
    paymentLink = await getPayosPaymentLink(orderCode);
  } catch (error) {
    return { status: 'pending', message: error?.message || 'Waiting for payOS confirmation', payment_code: payment.payment_code, booking_code: bookingCode };
  }

  const payosStatus = String(paymentLink.status || '').toUpperCase();

  if (payosStatus === 'PAID') {
    const expectedAmount = getPaymentChargeAmount(payment);
    const paidAmount = Number(paymentLink.amountPaid || paymentLink.amount || 0);
    if (paidAmount !== expectedAmount) {
      return { status: 'error', message: `Amount mismatch`, payment_code: payment.payment_code, booking_code: bookingCode };
    }

    await confirmPayment(payment.payment_code, null, true);
    return { status: 'success', message: 'Success', payment_code: payment.payment_code, booking_code: bookingCode };
  }

  if (['CANCELLED', 'FAILED', 'EXPIRED'].includes(payosStatus)) {
    if (!isTerminalCancelledStatus(payment.status)) {
      await cancelPayment({ payment_code: payment.payment_code });
    }
    return { status: payosStatus === 'CANCELLED' ? 'cancel' : 'error', message: `payOS status: ${payosStatus}`, payment_code: payment.payment_code, booking_code: bookingCode };
  }

  return { status: 'pending', message: `payOS status: ${payosStatus || 'PENDING'}`, payment_code: payment.payment_code, booking_code: bookingCode };
};

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  previewPayment,
  createPayment,
  initPayment,
  confirmPayment,
  cancelPayment,
  getPaymentByCode,
  getPayosCheckoutUrl,
  getPaypalCheckoutUrl,
  handleBankWebhook,
  handlePayosWebhook,
  handlePayosReturn,
  handleMomoIpn,
  handleMomoReturn,
  handlePaypalReturn,
  handlePaypalCancel,
  rollbackReservedVoucherUsageForBooking,
};
