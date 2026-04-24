"use strict";

/**
 * SQL queries liên quan đến bảng payments
 * Được dùng bởi: payment.service.js
 */

const SELECT_BOOKING_FOR_PAYMENT = (lockRow) =>
  `SELECT
     b.id, b.booking_code, b.user_id,
     b.total_price, b.status, b.held_until, b.contact_email,
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

const SELECT_MY_PAYMENTS =
  `SELECT
     p.id, p.payment_code, p.booking_id, p.payment_method,
     p.amount, p.discount_amount, p.final_amount,
     p.voucher_code, p.status,
     p.expires_at, p.paid_at, p.created_at,
     b.booking_code,
     f.flight_number,
     dep.code AS from_code, dep.city AS from_city,
     arr.code AS to_code,   arr.city AS to_city,
     f.departure_time
   FROM payments p
   JOIN bookings b ON b.id = p.booking_id
   JOIN flights  f ON f.id = b.outbound_flight_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   WHERE p.user_id = $1
   ORDER BY p.created_at DESC`;

module.exports = {
  SELECT_BOOKING_FOR_PAYMENT,
  FIND_SUCCESS_PAYMENT_BY_BOOKING,
  CANCEL_PENDING_PAYMENTS,
  INSERT_PAYMENT,
  SELECT_PAYMENT_WITH_BOOKING,
  UPDATE_PAYMENT_SUCCESS,
  CONFIRM_BOOKING_AFTER_PAYMENT,
  EXPIRE_PENDING_PAYMENT,
  UPDATE_PAYMENT_AFTER_CANCEL,
  SELECT_MY_PAYMENTS,
};
