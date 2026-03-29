const pool = require("../config/db");

/**
 * GET /api/payments/my
 * Lịch sử giao dịch của user đã đăng nhập
 * FIX: Route này không tồn tại trước đây → Transactions page luôn rỗng
 */
const getMyPayments = async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT
        p.id,
        p.payment_code,
        p.booking_id,
        p.payment_method,
        p.amount,
        p.discount_amount,
        p.final_amount,
        p.status,
        p.created_at,
        p.paid_at,
        b.booking_code,
        b.trip_type,
        f.flight_number,
        dep.code  AS dep_code,
        dep.city  AS dep_city,
        arr.code  AS arr_code,
        arr.city  AS arr_city,
        f.departure_time
       FROM payments p
       JOIN bookings b  ON b.id = p.booking_id
       JOIN flights  f  ON f.id = b.outbound_flight_id
       JOIN airports dep ON dep.id = f.departure_airport_id
       JOIN airports arr ON arr.id = f.arrival_airport_id
       WHERE b.user_id = $1
       ORDER BY p.created_at DESC
       LIMIT 100`,
      [userId],
    );

    const payments = result.rows.map((row) => ({
      payment_code:    row.payment_code,
      booking_code:    row.booking_code,
      payment_method:  row.payment_method,
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
      total: payments.length,
      payments,
    });
  } catch (err) {
    console.error("getMyPayments error:", err.message);
    res.json({ message: "No transactions found", total: 0, payments: [] });
  }
};

module.exports = { getMyPayments };