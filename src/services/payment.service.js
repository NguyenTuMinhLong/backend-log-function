const pool = require("../config/db");

const VALID_PAYMENT_METHODS = ["BANK_QR", "BANK_TRANSFER", "MOMO"];

const normalizeVoucherCode = (code) => {
  if (!code || typeof code !== "string") {
    return null;
  }

  const normalized = code.trim().toUpperCase();
  return normalized || null;
};

const generatePaymentCode = () => {
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const random = Math.random().toString(16).slice(2, 8).toUpperCase();
  return `PAY-${timestamp}-${random}`;
};

const toNumber = (value) => Number(value || 0);

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
});

const getBookingForPayment = async (client, bookingCode, userId, lockRow = false) => {
  const result = await client.query(
    `SELECT
       b.id,
       b.booking_code,
       b.user_id,
       b.total_price,
       b.status,
       b.held_until,
       b.contact_email,
       f.airline_id AS outbound_airline_id
     FROM bookings b
     JOIN flights f ON f.id = b.outbound_flight_id
     WHERE b.booking_code = $1
     ${lockRow ? "FOR UPDATE" : ""}`,
    [bookingCode]
  );

  if (result.rows.length === 0) {
    throw new Error("Không tìm thấy booking");
  }

  const booking = result.rows[0];

  if (booking.user_id && !userId) {
    throw new Error("Bạn cần đăng nhập để thanh toán booking này");
  }

  if (booking.user_id && userId && Number(booking.user_id) !== Number(userId)) {
    throw new Error("Bạn không có quyền thao tác với booking này");
  }

  return booking;
};

const ensureBookingPayable = (booking) => {
  if (booking.status === "cancelled") {
    throw new Error("Booking này đã bị hủy");
  }

  if (booking.status === "expired") {
    throw new Error("Booking này đã hết hạn");
  }

  if (booking.status === "confirmed") {
    throw new Error("Booking này đã thanh toán");
  }

  if (booking.status !== "pending") {
    throw new Error(`Không thể thanh toán booking ở trạng thái ${booking.status}`);
  }

  if (booking.held_until && new Date(booking.held_until) < new Date()) {
    throw new Error("Booking đã quá thời gian giữ chỗ");
  }
};

const getVoucherQuote = async (client, booking, userId, voucherCode) => {
  const normalizedCode = normalizeVoucherCode(voucherCode);

  if (!normalizedCode) {
    return {
      voucher: null,
      discountAmount: 0,
      finalAmount: toNumber(booking.total_price),
    };
  }

  const voucherResult = await client.query(
    `SELECT *
     FROM vouchers
     WHERE code = $1
     LIMIT 1`,
    [normalizedCode]
  );

  if (voucherResult.rows.length === 0) {
    throw new Error("Voucher không tồn tại");
  }

  const voucher = voucherResult.rows[0];
  const totalPrice = toNumber(booking.total_price);

  if (!voucher.is_active) {
    throw new Error("Voucher đã bị vô hiệu hóa");
  }

  if (voucher.start_at && new Date(voucher.start_at) > new Date()) {
    throw new Error("Voucher chưa đến thời gian sử dụng");
  }

  if (voucher.expiry_at && new Date(voucher.expiry_at) < new Date()) {
    throw new Error("Voucher đã hết hạn");
  }

  if (voucher.airline_id && Number(voucher.airline_id) !== Number(booking.outbound_airline_id)) {
    throw new Error("Voucher không áp dụng cho hãng bay của booking này");
  }

  if (totalPrice < toNumber(voucher.min_order)) {
    throw new Error(`Đơn hàng chưa đạt giá trị tối thiểu ${toNumber(voucher.min_order)}`);
  }

  const usageCountResult = await client.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'reserved') AS reserved_count,
       COUNT(*) FILTER (WHERE LOWER(status) = 'used') AS used_count
     FROM coupon_usages
     WHERE coupon_id = $1`,
    [voucher.id]
  );

  const reservedCount = Number(usageCountResult.rows[0].reserved_count || 0);
  const usedUsageCount = Number(usageCountResult.rows[0].used_count || 0);
  const occupiedCount = Math.max(toNumber(voucher.used_count), usedUsageCount) + reservedCount;

  if (voucher.usage_limit !== null && occupiedCount >= Number(voucher.usage_limit)) {
    throw new Error("Voucher đã hết lượt sử dụng");
  }

  if (voucher.usage_limit_per_user !== null) {
    if (!userId) {
      throw new Error("Voucher này yêu cầu đăng nhập để kiểm tra giới hạn sử dụng");
    }

    const perUserResult = await client.query(
      `SELECT COUNT(*) AS total
       FROM coupon_usages
       WHERE coupon_id = $1
         AND user_id = $2
         AND LOWER(status) IN ('reserved', 'used')`,
      [voucher.id, userId]
    );

    if (Number(perUserResult.rows[0].total || 0) >= Number(voucher.usage_limit_per_user)) {
      throw new Error("Bạn đã sử dụng hết số lượt cho voucher này");
    }
  }

  if (voucher.welcome_only) {
    if (!userId) {
      throw new Error("Voucher welcome_only yêu cầu đăng nhập");
    }

    const welcomeResult = await client.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM bookings
           WHERE user_id = $1
             AND status = 'confirmed'
         ) AS has_confirmed_booking,
         EXISTS (
           SELECT 1 FROM payments
           WHERE user_id = $1
             AND status = 'SUCCESS'
         ) AS has_success_payment`,
      [userId]
    );

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

  const finalAmount = Math.max(totalPrice - discountAmount, 0);

  return {
    voucher,
    discountAmount,
    finalAmount,
  };
};

const rollbackReservedVoucherUsageForBooking = async (client, bookingId) => {
  await client.query(
    `UPDATE coupon_usages
     SET status = 'rolled_back',
         rolled_back_at = NOW()
     WHERE booking_id = $1
       AND status = 'reserved'`,
    [bookingId]
  );
};

const previewPayment = async (data, userId = null) => {
  const bookingCode = String(data.booking_code || "").trim().toUpperCase();
  if (!bookingCode) {
    throw new Error("booking_code là bắt buộc");
  }

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

const createPayment = async (data, userId = null) => {
  const bookingCode = String(data.booking_code || "").trim().toUpperCase();
  const paymentMethod = String(data.payment_method || "").trim().toUpperCase();

  if (!bookingCode) {
    throw new Error("booking_code là bắt buộc");
  }

  if (!VALID_PAYMENT_METHODS.includes(paymentMethod)) {
    throw new Error(`payment_method phải là: ${VALID_PAYMENT_METHODS.join(", ")}`);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const booking = await getBookingForPayment(client, bookingCode, userId, true);
    ensureBookingPayable(booking);

    const paidResult = await client.query(
      `SELECT id
       FROM payments
       WHERE booking_id = $1
         AND status = 'SUCCESS'
       LIMIT 1`,
      [booking.id]
    );

    if (paidResult.rows.length > 0) {
      throw new Error("Booking này đã có thanh toán thành công");
    }

    await client.query(
      `UPDATE payments
       SET status = 'CANCELLED',
           cancelled_at = NOW(),
           updated_at = NOW()
       WHERE booking_id = $1
         AND status = 'PENDING'`,
      [booking.id]
    );

    await rollbackReservedVoucherUsageForBooking(client, booking.id);

    const quote = await getVoucherQuote(client, booking, userId, data.voucher_code);

    const paymentCode = generatePaymentCode();

    const paymentResult = await client.query(
      `INSERT INTO payments (
         booking_id,
         user_id,
         payment_code,
         payment_method,
         amount,
         discount_amount,
         final_amount,
         voucher_id,
         voucher_code,
         status,
         expires_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)
       RETURNING *`,
      [
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
      ]
    );

    if (quote.voucher) {
      await client.query(
        `INSERT INTO coupon_usages (
           coupon_id,
           user_id,
           booking_id,
           status,
           discount_amount,
           reserved_at
         )
         VALUES ($1, $2, $3, 'reserved', $4, NOW())`,
        [
          quote.voucher.id,
          booking.user_id || userId || null,
          booking.id,
          quote.discountAmount,
        ]
      );
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
  if (!normalizedPaymentCode) {
    throw new Error("paymentCode là bắt buộc");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT
         p.*,
         b.booking_code,
         b.user_id AS booking_user_id,
         b.status AS booking_status
       FROM payments p
       JOIN bookings b ON b.id = p.booking_id
       WHERE p.payment_code = $1
       FOR UPDATE`,
      [normalizedPaymentCode]
    );

    if (result.rows.length === 0) {
      throw new Error("Không tìm thấy payment");
    }

    const payment = result.rows[0];

    if (payment.booking_user_id && !userId) {
      throw new Error("Bạn cần đăng nhập để xác nhận payment này");
    }

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

    const paymentUpdate = await client.query(
      `UPDATE payments
       SET status = 'SUCCESS',
           paid_at = NOW(),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [payment.id]
    );

    await client.query(
      `UPDATE bookings
       SET status = 'confirmed',
           updated_at = NOW()
       WHERE id = $1`,
      [payment.booking_id]
    );

    if (payment.voucher_id) {
      const usageResult = await client.query(
        `UPDATE coupon_usages
         SET status = 'USED',
             used_at = NOW()
         WHERE booking_id = $1
           AND coupon_id = $2
           AND status = 'reserved'
         RETURNING id`,
        [payment.booking_id, payment.voucher_id]
      );

      if (usageResult.rows.length > 0) {
        await client.query(
          `UPDATE vouchers
           SET used_count = used_count + 1,
               updated_at = NOW()
           WHERE id = $1`,
          [payment.voucher_id]
        );
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
