const pool = require("../config/db");
const QP   = require("../queries/payment.queries");
const QC   = require("../queries/coupon.queries");

const VALID_PAYMENT_METHODS = ["BANK_QR", "BANK_TRANSFER", "MOMO"];

const normalizeVoucherCode = (code) => {
  if (!code || typeof code !== "string") return null;
  const normalized = code.trim().toUpperCase();
  return normalized || null;
};

const generatePaymentCode = () => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random    = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `PAY-${timestamp}-${random}`;
};

const toNumber = (value) => Number(value || 0);

const buildPaymentResponse = (payment, bookingCode) => ({
  id:             payment.id,
  payment_code:   payment.payment_code,
  booking_id:     payment.booking_id,
  booking_code:   bookingCode,
  payment_method: payment.payment_method,
  amount:         toNumber(payment.amount),
  discount_amount: toNumber(payment.discount_amount),
  final_amount:   toNumber(payment.final_amount),
  voucher_id:     payment.voucher_id || null,
  voucher_code:   payment.voucher_code || null,
  status:         payment.status,
  expires_at:     payment.expires_at || null,
  paid_at:        payment.paid_at || null,
  created_at:     payment.created_at || null,
});

const getBookingForPayment = async (client, bookingCode, userId, lockRow = false) => {
  const result = await client.query(QP.SELECT_BOOKING_FOR_PAYMENT(lockRow), [bookingCode]);

  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

  const booking = result.rows[0];

  if (booking.user_id && !userId) throw new Error("Bạn cần đăng nhập để thanh toán booking này");
  if (booking.user_id && userId && Number(booking.user_id) !== Number(userId)) {
    throw new Error("Bạn không có quyền thao tác với booking này");
  }

  return booking;
};

const ensureBookingPayable = (booking) => {
  if (booking.status === "cancelled") throw new Error("Booking này đã bị hủy");
  if (booking.status === "expired")   throw new Error("Booking này đã hết hạn");
  if (booking.status === "confirmed") throw new Error("Booking này đã thanh toán");
  if (booking.status !== "pending")   throw new Error(`Không thể thanh toán booking ở trạng thái ${booking.status}`);
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

  const voucher    = voucherResult.rows[0];
  const totalPrice = toNumber(booking.total_price);

  if (!voucher.is_active)                                               throw new Error("Voucher đã bị vô hiệu hóa");
  if (voucher.start_at  && new Date(voucher.start_at)  > new Date())   throw new Error("Voucher chưa đến thời gian sử dụng");
  if (voucher.expiry_at && new Date(voucher.expiry_at) < new Date())   throw new Error("Voucher đã hết hạn");
  if (voucher.airline_id && Number(voucher.airline_id) !== Number(booking.outbound_airline_id)) {
    throw new Error("Voucher không áp dụng cho hãng bay của booking này");
  }
  if (totalPrice < toNumber(voucher.min_order)) {
    throw new Error(`Đơn hàng chưa đạt giá trị tối thiểu ${toNumber(voucher.min_order)}`);
  }

  const usageCountResult = await client.query(QC.SELECT_COUPON_USAGE_COUNTS, [voucher.id]);
  const reservedCount    = Number(usageCountResult.rows[0].reserved_count || 0);
  const usedUsageCount   = Number(usageCountResult.rows[0].used_count     || 0);
  const occupiedCount    = Math.max(toNumber(voucher.used_count), usedUsageCount) + reservedCount;

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
    const welcomeState  = welcomeResult.rows[0];
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

const previewPayment = async (data, userId = null) => {
  const bookingCode = String(data.booking_code || "").trim().toUpperCase();
  if (!bookingCode) throw new Error("booking_code là bắt buộc");

  const client = await pool.connect();
  try {
    const booking = await getBookingForPayment(client, bookingCode, userId, false);
    ensureBookingPayable(booking);
    const quote = await getVoucherQuote(client, booking, userId, data.voucher_code);

    return {
      booking_id:      booking.id,
      booking_code:    booking.booking_code,
      amount:          toNumber(booking.total_price),
      discount_amount: quote.discountAmount,
      final_amount:    quote.finalAmount,
      voucher: quote.voucher
        ? {
            id:           quote.voucher.id,
            code:         quote.voucher.code,
            type:         quote.voucher.type,
            value:        toNumber(quote.voucher.value),
            max_discount: quote.voucher.max_discount !== null ? toNumber(quote.voucher.max_discount) : null,
          }
        : null,
    };
  } finally {
    client.release();
  }
};

const createPayment = async (data, userId = null) => {
  const bookingCode   = String(data.booking_code   || "").trim().toUpperCase();
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

    const quote       = await getVoucherQuote(client, booking, userId, data.voucher_code);
    const paymentCode = generatePaymentCode();

    const paymentResult = await client.query(QP.INSERT_PAYMENT, [
      booking.id,
      booking.user_id || userId || null,
      paymentCode,
      paymentMethod,
      toNumber(booking.total_price),
      quote.discountAmount,
      quote.finalAmount,
      quote.voucher ? quote.voucher.id   : null,
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

const confirmPayment = async (paymentCode, userId = null) => {
  const normalizedPaymentCode = String(paymentCode || "").trim().toUpperCase();
  if (!normalizedPaymentCode) throw new Error("paymentCode là bắt buộc");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(QP.SELECT_PAYMENT_WITH_BOOKING, [normalizedPaymentCode]);
    if (result.rows.length === 0) throw new Error("Không tìm thấy payment");

    const payment = result.rows[0];

    if (payment.booking_user_id && !userId) throw new Error("Bạn cần đăng nhập để xác nhận payment này");
    if (payment.booking_user_id && userId && Number(payment.booking_user_id) !== Number(userId)) {
      throw new Error("Bạn không có quyền thao tác payment này");
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

module.exports = {
  previewPayment,
  createPayment,
  confirmPayment,
  rollbackReservedVoucherUsageForBooking,
};
