const pool = require("../config/db");
const paymentService = require("../services/payment.service");
const QP = require("../queries/payment.queries");

const previewPayment = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await paymentService.previewPayment(req.body, userId);
    res.json({
      message: "Preview payment thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const createPayment = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await paymentService.createPayment(req.body, userId);
    res.status(201).json({
      message: "Tạo payment thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const confirmPayment = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await paymentService.confirmPayment(req.params.paymentCode, userId);
    res.json({
      message: "Xác nhận payment thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/payments/my
 * Lịch sử giao dịch của user đã đăng nhập
 * FIX: Route này không tồn tại trước đây → Transactions page luôn rỗng
 */
const getMyPayments = async (req, res) => {
  try {
    const userId = req.user.id;
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 10));
    const offset = (page - 1) * limit;
    const dk     = QP.buildPaymentStatusFilter(req.query.filter);

    // Đóng payment PENDING đã quá hạn trước khi đọc — tránh hiện "Chờ thanh toán"
    // cho giao dịch từ nhiều tháng trước
    await pool.query(QP.EXPIRE_STALE_PENDING_PAYMENTS_FOR_USER, [userId]);

    const [countResult, statsResult, result] = await Promise.all([
      pool.query(QP.COUNT_MY_PAYMENTS(dk), [userId]),
      pool.query(QP.SELECT_MY_PAYMENT_STATS, [userId]),
      pool.query(QP.SELECT_MY_PAYMENTS(dk), [userId, limit, offset]),
    ]);
    const total = parseInt(countResult.rows[0].total, 10) || 0;
    const s     = statsResult.rows[0] || {};

    const payments = result.rows.map((row) => ({
      payment_code:    row.payment_code,
      booking_code:    row.booking_code,
      payment_method:  row.payment_method,
      voucher_code:    row.voucher_code || null,
      amount:          parseFloat(row.amount || 0),
      discount_amount: parseFloat(row.discount_amount || 0),
      final_amount:    parseFloat(row.final_amount || row.amount || 0),
      status:          row.status?.toUpperCase(),
      created_at:      row.created_at,
      paid_at:         row.paid_at,
      trip_type:       row.trip_type,
      flight: {
        flight_number: row.flight_number,
        departure: { code: row.dep_code, city: row.dep_city, time: row.departure_time },
        arrival:   { code: row.arr_code, city: row.arr_city },
      },
    }));

    res.json({
      message: "Lấy lịch sử giao dịch thành công",
      total,
      payments,
      pagination: {
        page,
        limit,
        total,
        total_pages: Math.max(1, Math.ceil(total / limit)),
      },
      // Thống kê trên toàn bộ giao dịch — độc lập với tab lọc và trang hiện tại
      stats: {
        total_tx:        parseInt(s.total_tx, 10)        || 0,
        total_paid:      parseFloat(s.total_paid)        || 0,
        total_pending:   parseInt(s.total_pending, 10)   || 0,
        total_cancelled: parseInt(s.total_cancelled, 10) || 0,
      },
    });
  } catch (err) {
    console.error("getMyPayments error:", err.message);
    res.json({
      message: "No transactions found",
      total: 0,
      payments: [],
      pagination: { page: 1, limit: 10, total: 0, total_pages: 1 },
      stats: { total_tx: 0, total_paid: 0, total_pending: 0, total_cancelled: 0 },
    });
  }
};

module.exports = { getMyPayments, previewPayment, createPayment, confirmPayment };
