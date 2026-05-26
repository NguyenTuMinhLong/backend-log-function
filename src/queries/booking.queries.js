"use strict";

/**
 * SQL queries liên quan đến bảng bookings, passengers, tickets, flight_seat_assignments
 * Được dùng bởi: booking.service.js, admin.flight.service.js
 */

// ── Bookings ───────────────────────────────────────────────────────────────────

const CHECK_BOOKING_CODE_EXISTS =
  `SELECT id FROM bookings WHERE booking_code = $1`;

const INSERT_BOOKING =
  `INSERT INTO bookings (
     booking_code, user_id,
     outbound_flight_id, outbound_seat_class,
     return_flight_id,   return_seat_class,
     trip_type,
     total_adults, total_children, total_infants,
     base_price, total_price,
     status, contact_name, contact_email, contact_phone,
     held_until
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending', $13, $14, $15, $16)
   RETURNING *`;

const SELECT_BOOKING_DETAIL =
  `SELECT b.*,
     f_out.flight_number    AS outbound_flight_number,
     f_out.departure_time   AS outbound_departure_time,
     f_out.arrival_time     AS outbound_arrival_time,
     f_out.duration_minutes AS outbound_duration,
     al_out.name            AS outbound_airline_name,
     al_out.code            AS outbound_airline_code,
     al_out.logo_url        AS outbound_airline_logo,
     al_out.logo_dark       AS outbound_airline_logo_dark,
     al_out.logo_light      AS outbound_airline_logo_light,
     dep_out.code AS outbound_dep_code, dep_out.city AS outbound_dep_city,
     arr_out.code AS outbound_arr_code, arr_out.city AS outbound_arr_city,
     f_ret.flight_number    AS return_flight_number,
     f_ret.departure_time   AS return_departure_time,
     f_ret.arrival_time     AS return_arrival_time,
     f_ret.duration_minutes AS return_duration,
     al_ret.name            AS return_airline_name,
     al_ret.code            AS return_airline_code,
     al_ret.logo_url        AS return_airline_logo,
     al_ret.logo_dark       AS return_airline_logo_dark,
     al_ret.logo_light      AS return_airline_logo_light,
     dep_ret.code AS return_dep_code, dep_ret.city AS return_dep_city,
     arr_ret.code AS return_arr_code, arr_ret.city AS return_arr_city
   FROM bookings b
   JOIN flights  f_out   ON f_out.id  = b.outbound_flight_id
   JOIN airlines al_out  ON al_out.id = f_out.airline_id
   JOIN airports dep_out ON dep_out.id = f_out.departure_airport_id
   JOIN airports arr_out ON arr_out.id = f_out.arrival_airport_id
   LEFT JOIN flights  f_ret   ON f_ret.id  = b.return_flight_id
   LEFT JOIN airlines al_ret  ON al_ret.id = f_ret.airline_id
   LEFT JOIN airports dep_ret ON dep_ret.id = f_ret.departure_airport_id
   LEFT JOIN airports arr_ret ON arr_ret.id = f_ret.arrival_airport_id
   WHERE b.booking_code = $1`;

const SELECT_MY_BOOKINGS = (dk) =>
  `SELECT
     b.id,
     b.booking_code,
     b.status,
     b.trip_type,
     b.total_adults,
     b.total_children,
     b.total_infants,
     b.total_price,
     b.created_at,
     f.id AS flight_id,
     f.flight_number,
     f.departure_time,
     f.arrival_time,
     dep.code AS dep_code, dep.city AS dep_city,
     arr.code AS arr_code, arr.city AS arr_city,
     al.name AS airline_name, al.code AS airline_code,
     COUNT(p.id) AS passenger_count,
     CASE
       WHEN b.status = 'cancelled' THEN 'cancelled'
       WHEN b.status = 'expired'   THEN 'expired'
       WHEN b.status = 'pending'   THEN 'upcoming'
       WHEN b.status = 'confirmed' THEN 'completed'
       ELSE 'upcoming'
     END AS history_type,
     (
       SELECT final_amount FROM payments
       WHERE booking_id = b.id
       ORDER BY created_at DESC LIMIT 1
     ) AS final_amount
   FROM bookings b
   JOIN flights  f   ON f.id  = b.outbound_flight_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   JOIN airlines al  ON al.id  = f.airline_id
   LEFT JOIN passengers p ON p.booking_id = b.id
   ${dk}
   GROUP BY b.id, f.id, dep.id, arr.id, al.id
   ORDER BY b.created_at DESC`;

const SELECT_BOOKING_PAYMENT_INFO =
  `SELECT final_amount, discount_amount, status, payment_method
   FROM payments
   WHERE booking_id = $1
   ORDER BY created_at DESC
   LIMIT 1`;

const CANCEL_BOOKING =
  `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`;

const EXPIRE_BOOKING =
  `UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1`;

const SELECT_PENDING_EXPIRED_BOOKINGS =
  `SELECT * FROM bookings WHERE status = 'pending' AND held_until < NOW() FOR UPDATE SKIP LOCKED`;

const SELECT_BOOKING_FOR_CANCEL =
  `SELECT b.id, b.booking_code, b.user_id,
          b.outbound_flight_id, b.return_flight_id,
          b.outbound_seat_class, b.return_seat_class,
          b.trip_type, b.total_price, b.status, b.created_at, b.updated_at,
          f.departure_time
   FROM bookings b
   JOIN flights f ON f.id = b.outbound_flight_id
   WHERE b.booking_code = $1
   LIMIT 1`;

const SELECT_BOOKING_CANCEL_PAYMENT =
  `SELECT id, amount, discount_amount, final_amount, status, payment_method, paid_at, created_at
   FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`;

const UPDATE_BOOKING_STATUS =
  `UPDATE bookings SET status = $1, updated_at = NOW() WHERE id = $2
   RETURNING id, booking_code, status`;

// ── Admin: Bookings ────────────────────────────────────────────────────────────

const COUNT_BOOKINGS = (dk) =>
  `SELECT COUNT(*) FROM bookings b ${dk}`;

const SELECT_BOOKINGS_ADMIN = (dk, gioiHan, viTri) =>
  `SELECT b.id, b.booking_code, b.status, b.trip_type,
     b.total_adults, b.total_children, b.total_infants,
     b.total_price,
     COALESCE(anc.ancillary_total, 0) AS ancillary_total,
     b.total_price + COALESCE(anc.ancillary_total, 0) AS grand_total,
     (SELECT p.final_amount FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS final_amount,
     (SELECT p.discount_amount FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS discount_amount,
     b.held_until, b.created_at,
     b.contact_name, b.contact_email, b.contact_phone,
     b.user_id,
     f_out.flight_number  AS outbound_flight,
     dep_out.code         AS from_code, dep_out.city AS from_city,
     arr_out.code         AS to_code,   arr_out.city AS to_city,
     f_out.departure_time AS departure_time
   FROM bookings b
   JOIN flights  f_out   ON f_out.id   = b.outbound_flight_id
   JOIN airports dep_out ON dep_out.id = f_out.departure_airport_id
   JOIN airports arr_out ON arr_out.id = f_out.arrival_airport_id
   LEFT JOIN (
     SELECT booking_id, COALESCE(SUM(total_price), 0) AS ancillary_total
     FROM booking_ancillaries WHERE status != 'cancelled'
     GROUP BY booking_id
   ) anc ON anc.booking_id = b.id
   ${dk}
   ORDER BY b.created_at DESC
   LIMIT $${gioiHan} OFFSET $${viTri}`;

const SELECT_BOOKING_DETAIL_ADMIN =
  `SELECT b.*,
     COALESCE(anc.ancillary_total, 0) AS ancillary_total,
     b.total_price + COALESCE(anc.ancillary_total, 0) AS grand_total,
     (SELECT p.final_amount FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS final_amount,
     (SELECT p.discount_amount FROM payments p WHERE p.booking_id = b.id ORDER BY p.created_at DESC LIMIT 1) AS discount_amount,
     f_out.flight_number AS outbound_flight_number,
     f_out.departure_time AS outbound_dep_time, f_out.arrival_time AS outbound_arr_time,
     al_out.name AS outbound_airline, dep_out.code AS from_code, arr_out.code AS to_code,
     f_ret.flight_number AS return_flight_number,
     f_ret.departure_time AS return_dep_time, f_ret.arrival_time AS return_arr_time
   FROM bookings b
   JOIN flights  f_out   ON f_out.id  = b.outbound_flight_id
   JOIN airlines al_out  ON al_out.id = f_out.airline_id
   JOIN airports dep_out ON dep_out.id = f_out.departure_airport_id
   JOIN airports arr_out ON arr_out.id = f_out.arrival_airport_id
   LEFT JOIN flights f_ret ON f_ret.id = b.return_flight_id
   LEFT JOIN (
     SELECT booking_id, COALESCE(SUM(total_price), 0) AS ancillary_total
     FROM booking_ancillaries WHERE status != 'cancelled'
     GROUP BY booking_id
   ) anc ON anc.booking_id = b.id
   WHERE b.id = $1`;

// ── Passengers ─────────────────────────────────────────────────────────────────

const INSERT_PASSENGER =
  `INSERT INTO passengers (
     booking_id, flight_type, passenger_type,
     full_name, date_of_birth, gender,
     nationality, passport_number, passport_expiry,
     baggage_kg, extra_baggage_kg, baggage_price
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
   RETURNING id`;

const SELECT_PASSENGERS_BY_BOOKING =
  `SELECT id, flight_type, passenger_type, full_name, date_of_birth, gender,
          nationality, passport_number, seat_number,
          baggage_kg, extra_baggage_kg, baggage_price
   FROM passengers WHERE booking_id = $1 ORDER BY flight_type, passenger_type`;

const SELECT_ALL_PASSENGERS_BY_BOOKING =
  `SELECT * FROM passengers WHERE booking_id = $1 ORDER BY flight_type, passenger_type`;

// ── Seat Assignments ───────────────────────────────────────────────────────────

const CANCEL_BOOKING_TICKETS =
  `UPDATE tickets SET status = 'cancelled' WHERE booking_id = $1 RETURNING id`;

const SELECT_SEAT_ASSIGNMENTS =
  `SELECT id, flight_id, class FROM flight_seat_assignments WHERE booking_id = $1`;

const RELEASE_SEAT_ASSIGNMENTS =
  `UPDATE flight_seat_assignments
   SET status = 'available', passenger_id = NULL, booking_id = NULL
   WHERE booking_id = $1`;

const EXPIRE_SEAT_ASSIGNMENTS =
  `UPDATE flight_seat_assignments
   SET status = 'available', passenger_id = NULL, booking_id = NULL
   WHERE booking_id = $1`;

// ── Statistics ─────────────────────────────────────────────────────────────────

const STATS_BOOKING_SUMMARY = (locNgay) =>
  `SELECT b.status, COUNT(*) AS count,
     SUM(b.total_price + COALESCE(anc.ancillary_total, 0)) AS revenue
   FROM bookings b
   LEFT JOIN (
     SELECT booking_id, COALESCE(SUM(total_price), 0) AS ancillary_total
     FROM booking_ancillaries WHERE status != 'cancelled'
     GROUP BY booking_id
   ) anc ON anc.booking_id = b.id
   WHERE 1=1 ${locNgay}
   GROUP BY b.status ORDER BY b.status`;

const STATS_DAILY_REVENUE = (locNgay) =>
  `SELECT (b.created_at AT TIME ZONE '+07')::date AS date,
          COUNT(*) AS bookings,
          COUNT(*) FILTER (WHERE b.status IN ('confirmed','refund_pending','refunded')) AS valid_bookings,
          SUM(COALESCE(pay.final_amount, b.total_price + COALESCE(anc.ancillary_total, 0)))
            FILTER (WHERE b.status IN ('confirmed','refund_pending','refunded')) AS revenue,
          COALESCE(SUM(ref.net_refunded)
            FILTER (WHERE b.status IN ('refund_pending','refunded')), 0) AS refunded
   FROM bookings b
   LEFT JOIN (
     SELECT booking_id, COALESCE(SUM(total_price), 0) AS ancillary_total
     FROM booking_ancillaries WHERE status != 'cancelled'
     GROUP BY booking_id
   ) anc ON anc.booking_id = b.id
   LEFT JOIN LATERAL (
     SELECT final_amount FROM payments
     WHERE booking_id = b.id
     ORDER BY created_at DESC LIMIT 1
   ) pay ON true
   LEFT JOIN (
     SELECT booking_id, SUM(net_refund_amount) AS net_refunded
     FROM refunds WHERE status = 'completed'
     GROUP BY booking_id
   ) ref ON ref.booking_id = b.id
   WHERE ${locNgay
     ? `(b.created_at AT TIME ZONE '+07')::date BETWEEN $1::date AND $2::date`
     : `(b.created_at AT TIME ZONE '+07')::date >= (NOW() AT TIME ZONE '+07')::date - INTERVAL '6 days'`}
   GROUP BY (b.created_at AT TIME ZONE '+07')::date
   ORDER BY date ASC`;

const STATS_POPULAR_FLIGHTS = (locNgayDat) =>
  `SELECT f.flight_number,
          al.name AS airline,
          dep.city AS from_city, arr.city AS to_city,
          COUNT(b.id) AS total_bookings,
          SUM(b.total_adults + b.total_children + b.total_infants) AS total_passengers
   FROM bookings b
   JOIN flights  f   ON f.id   = b.outbound_flight_id
   JOIN airlines al  ON al.id  = f.airline_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   WHERE b.status IN ('confirmed','refund_pending','refunded') ${locNgayDat}
   GROUP BY f.id, f.flight_number, al.name, dep.city, arr.city
   ORDER BY total_bookings DESC
   LIMIT 5`;

const STATS_OVERVIEW = (locNgay) =>
  `SELECT
     COUNT(*) FILTER (WHERE b.status IN ('confirmed','refund_pending','refunded')) AS total_bookings,
     SUM(b.total_price + COALESCE(anc.ancillary_total, 0))
       FILTER (WHERE b.status IN ('confirmed','refund_pending','refunded'))        AS total_revenue,
     COALESCE((
       SELECT SUM(r.net_refund_amount)
       FROM refunds r
       JOIN bookings rb ON rb.id = r.booking_id
       WHERE r.status = 'completed'
       ${locNgay ? `AND (rb.created_at AT TIME ZONE '+07')::date BETWEEN $1::date AND $2::date` : ""}
     ), 0)                                                                         AS total_refunded,
     COUNT(*) FILTER (WHERE b.status = 'confirmed')                               AS confirmed,
     COUNT(*) FILTER (WHERE b.status = 'pending')                                 AS pending,
     COUNT(*) FILTER (WHERE b.status = 'cancelled')                               AS cancelled,
     COUNT(*) FILTER (WHERE b.status = 'expired')                                 AS expired,
     SUM(b.total_adults + b.total_children + b.total_infants)
       FILTER (WHERE b.status = 'confirmed')                                       AS total_passengers
   FROM bookings b
   LEFT JOIN (
     SELECT booking_id, COALESCE(SUM(total_price), 0) AS ancillary_total
     FROM booking_ancillaries WHERE status != 'cancelled'
     GROUP BY booking_id
   ) anc ON anc.booking_id = b.id
   WHERE 1=1 ${locNgay}`;

module.exports = {
  CHECK_BOOKING_CODE_EXISTS,
  INSERT_BOOKING,
  SELECT_BOOKING_DETAIL,
  SELECT_MY_BOOKINGS,
  SELECT_BOOKING_PAYMENT_INFO,
  CANCEL_BOOKING,
  EXPIRE_BOOKING,
  SELECT_PENDING_EXPIRED_BOOKINGS,
  SELECT_BOOKING_FOR_CANCEL,
  SELECT_BOOKING_CANCEL_PAYMENT,
  UPDATE_BOOKING_STATUS,
  COUNT_BOOKINGS,
  SELECT_BOOKINGS_ADMIN,
  SELECT_BOOKING_DETAIL_ADMIN,
  INSERT_PASSENGER,
  SELECT_PASSENGERS_BY_BOOKING,
  SELECT_ALL_PASSENGERS_BY_BOOKING,
  CANCEL_BOOKING_TICKETS,
  SELECT_SEAT_ASSIGNMENTS,
  RELEASE_SEAT_ASSIGNMENTS,
  EXPIRE_SEAT_ASSIGNMENTS,
  STATS_BOOKING_SUMMARY,
  STATS_DAILY_REVENUE,
  STATS_POPULAR_FLIGHTS,
  STATS_OVERVIEW,
};