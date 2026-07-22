"use strict";

/**
 * SQL queries liên quan đến bảng payments
 * Được dùng bởi: payment.service.js
 */

// total_price trả về = b.total_price (vé + hành lý) + tổng ancillary đã chọn
// (bảo hiểm, phòng chờ, wifi, suất ăn...) để khớp với "Tổng tiền" hiển thị
// cho khách (grand_total trong getBookingDetail) — dùng cho voucher min_order,
// tính discount và amount thanh toán thực tế.
const SELECT_BOOKING_FOR_PAYMENT = (lockRow) =>
  `SELECT
     b.id, b.booking_code, b.user_id,
     b.total_price + COALESCE((
       SELECT SUM(ba.total_price) FROM booking_ancillaries ba
       WHERE ba.booking_id = b.id AND ba.status != 'cancelled'
     ), 0) AS total_price,
     b.status, b.held_until, b.contact_email,
     f.airline_id AS outbound_airline_id
   FROM bookings b
   JOIN flights f ON f.id = b.outbound_flight_id
   WHERE b.booking_code = $1
   ${lockRow ? "FOR UPDATE" : ""}`;

const FIND_SUCCESS_PAYMENT_BY_BOOKING =
  `SELECT id FROM payments WHERE booking_id = $1 AND status = 'SUCCESS' LIMIT 1`;

const CANCEL_PENDING_PAYMENTS =
  `UPDATE payments
   SET status = 'CANCELLED', cancelled_at = NOW(), updated_at = NOW()
   WHERE booking_id = $1 AND status = 'PENDING'`;

const INSERT_PAYMENT =
  `INSERT INTO payments (
     booking_id, user_id, payment_code, payment_method,
     amount, discount_amount, final_amount,
     voucher_id, voucher_code,
     status, expires_at
   )
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10)
   RETURNING *`;

const SELECT_PAYMENT_WITH_BOOKING =
  `SELECT p.*, b.booking_code, b.user_id AS booking_user_id, b.status AS booking_status
   FROM payments p
   JOIN bookings b ON b.id = p.booking_id
   WHERE p.payment_code = $1
   FOR UPDATE`;

const UPDATE_PAYMENT_SUCCESS =
  `UPDATE payments
   SET status = 'SUCCESS', paid_at = NOW(), updated_at = NOW()
   WHERE id = $1
   RETURNING *`;

const CONFIRM_BOOKING_AFTER_PAYMENT =
  `UPDATE bookings SET status = 'confirmed', updated_at = NOW() WHERE id = $1`;

const EXPIRE_PENDING_PAYMENT =
  `UPDATE payments
   SET status = 'EXPIRED', expired_at = NOW(), updated_at = NOW()
   WHERE booking_id = $1 AND status = 'PENDING'`;

const UPDATE_PAYMENT_AFTER_CANCEL = (newStatus) =>
  `UPDATE payments SET status = '${newStatus}', cancelled_at = NOW(), updated_at = NOW() WHERE id = $1`;

// status = $1, id = $2  (dùng khi status là biến động — tránh string interpolation)
const UPDATE_PAYMENT_STATUS_BY_ID =
  `UPDATE payments
   SET status = $1, cancelled_at = NOW(), updated_at = NOW()
   WHERE id = $2`;

// Đóng các payment PENDING đã quá expires_at của riêng 1 user.
// Chạy ngay trước khi trả lịch sử giao dịch — nếu không, payment tạo từ nhiều
// tháng trước vẫn hiện "Chờ thanh toán" mãi mãi vì không có cron nào flip status.
const EXPIRE_STALE_PENDING_PAYMENTS_FOR_USER =
  `UPDATE payments p
   SET status = 'EXPIRED', expired_at = NOW(), updated_at = NOW()
   FROM bookings b
   WHERE b.id = p.booking_id
     AND b.user_id = $1
     AND p.status = 'PENDING'
     AND p.expires_at IS NOT NULL
     AND p.expires_at < NOW()`;

// dk: mệnh đề lọc theo tab (đã thanh toán / chờ / đã huỷ), rỗng = tất cả.
// Lọc phải nằm ở SQL chứ không phải frontend — nếu lọc sau khi phân trang thì
// tab "Đã huỷ" chỉ thấy được các dòng đã huỷ nằm trong trang hiện tại.
const COUNT_MY_PAYMENTS = (dk = "") =>
  `SELECT COUNT(*) AS total
   FROM payments p
   JOIN bookings b ON b.id = p.booking_id
   WHERE b.user_id = $1 ${dk}`;

// Thống kê trên TOÀN BỘ giao dịch, không phải trang hiện tại — nếu tính ở
// frontend thì các thẻ tổng quan sẽ chỉ phản ánh 10 dòng đang hiển thị.
const SELECT_MY_PAYMENT_STATS =
  `SELECT
     COUNT(*)                                                        AS total_tx,
     COALESCE(SUM(COALESCE(p.final_amount, p.amount))
              FILTER (WHERE UPPER(p.status) IN ('PAID','SUCCESS','COMPLETED','CONFIRMED')), 0) AS total_paid,
     COUNT(*) FILTER (WHERE UPPER(p.status) = 'PENDING')             AS total_pending,
     COUNT(*) FILTER (WHERE UPPER(p.status) IN ('CANCELLED','EXPIRED','FAILED')) AS total_cancelled
   FROM payments p
   JOIN bookings b ON b.id = p.booking_id
   WHERE b.user_id = $1`;

const SELECT_MY_PAYMENTS = (dk = "") =>
  `SELECT
     p.id, p.payment_code, p.booking_id, p.payment_method,
     p.amount, p.discount_amount, p.final_amount,
     p.voucher_code, p.status,
     p.expires_at, p.paid_at, p.created_at,
     b.booking_code, b.trip_type,
     f.flight_number,
     dep.code AS dep_code, dep.city AS dep_city,
     arr.code AS arr_code, arr.city AS arr_city,
     f.departure_time
   FROM payments p
   JOIN bookings b  ON b.id  = p.booking_id
   JOIN flights  f  ON f.id  = b.outbound_flight_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   WHERE b.user_id = $1 ${dk}
   ORDER BY p.created_at DESC
   LIMIT $2 OFFSET $3`;

// Nhóm status theo từng tab ở giao diện Lịch sử giao dịch
const PAYMENT_STATUS_GROUPS = {
  paid:    ["PAID", "SUCCESS", "COMPLETED", "CONFIRMED"],
  pending: ["PENDING"],
  cancel:  ["CANCELLED", "EXPIRED", "FAILED"],
};

// Trả về mệnh đề lọc an toàn (whitelist, không nội suy input của user vào SQL)
const buildPaymentStatusFilter = (filter) => {
  const group = PAYMENT_STATUS_GROUPS[filter];
  if (!group) return "";
  return `AND UPPER(p.status) IN (${group.map((s) => `'${s}'`).join(", ")})`;
};

module.exports = {
  SELECT_BOOKING_FOR_PAYMENT,
  UPDATE_PAYMENT_STATUS_BY_ID,
  FIND_SUCCESS_PAYMENT_BY_BOOKING,
  CANCEL_PENDING_PAYMENTS,
  INSERT_PAYMENT,
  SELECT_PAYMENT_WITH_BOOKING,
  UPDATE_PAYMENT_SUCCESS,
  CONFIRM_BOOKING_AFTER_PAYMENT,
  EXPIRE_PENDING_PAYMENT,
  UPDATE_PAYMENT_AFTER_CANCEL,
  EXPIRE_STALE_PENDING_PAYMENTS_FOR_USER,
  COUNT_MY_PAYMENTS,
  SELECT_MY_PAYMENT_STATS,
  SELECT_MY_PAYMENTS,
  buildPaymentStatusFilter,
  SELECT_PAYMENT_BY_BOOKING: `SELECT * FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
};
