"use strict";

/**
 * SQL queries liên quan đến bảng flights và flight_seats
 * Được dùng bởi: admin.flight.service.js, flight.service.js, booking.service.js
 */

// ── Admin: Flights ─────────────────────────────────────────────────────────────

const COUNT_FLIGHTS = (dk) =>
  `SELECT COUNT(*) FROM flights f
   JOIN airlines al  ON al.id  = f.airline_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   ${dk}`;

const SELECT_FLIGHTS = (dk, gioiHan, viTri) =>
  `SELECT
     f.id, f.flight_number, f.departure_time, f.arrival_time,
     f.duration_minutes, f.status, f.is_active, f.created_at, f.updated_at,
     al.id   AS airline_id,  al.code  AS airline_code,  al.name AS airline_name,
     dep.id  AS dep_id,      dep.code AS dep_code,      dep.city AS dep_city,
     arr.id  AS arr_id,      arr.code AS arr_code,      arr.city AS arr_city,
     json_agg(
       json_build_object(
         'class',           fs.class,
         'total_seats',     fs.total_seats,
         'available_seats', fs.available_seats,
         'base_price',      fs.base_price
       ) ORDER BY fs.base_price
     ) AS seats
   FROM flights f
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   LEFT JOIN flight_seats fs ON fs.flight_id = f.id
   ${dk}
   GROUP BY f.id, al.id, al.code, al.name,
            dep.id, dep.code, dep.city,
            arr.id, arr.code, arr.city
   ORDER BY f.departure_time ASC
   LIMIT $${gioiHan} OFFSET $${viTri}`;

// ... (giữ nguyên tất cả query cũ của bạn từ COUNT_FLIGHTS đến INCREASE_AVAILABLE_SEATS)

// ── Recommendation (CU-05) ─────────────────────────────────────────────────────

const GET_USER_BOOKED_FLIGHT_IDS =
  `SELECT DISTINCT outbound_flight_id 
   FROM bookings 
   WHERE user_id = $1 AND status = 'completed'`;

const GET_HISTORY_RECOMMENDATIONS_GENERAL =
  `SELECT 
     f.*,
     a.name as airline_name,
     dep.code as departure_code,
     arr.code as arrival_code,
     'Tuyến bay bạn hay đi' as reason
   FROM flights f
   JOIN airlines a ON f.airline_id = a.id
   JOIN airports dep ON f.departure_airport_id = dep.id
   JOIN airports arr ON f.arrival_airport_id = arr.id
   WHERE f.id != ALL($1)
     AND f.status = 'scheduled'
     AND f.is_active = true
     AND f.departure_time > NOW()
   ORDER BY f.departure_time ASC
   LIMIT $2`;

const GET_HISTORY_RECOMMENDATIONS_ROUTE =
  `SELECT 
     f.*,
     a.name as airline_name,
     dep.code as departure_code,
     arr.code as arrival_code,
     'Tuyến bay bạn hay đi' as reason
   FROM flights f
   JOIN airlines a ON f.airline_id = a.id
   JOIN airports dep ON f.departure_airport_id = dep.id
   JOIN airports arr ON f.arrival_airport_id = arr.id
   WHERE dep.code = $1 
     AND arr.code = $2
     AND f.id != ALL($3)
     AND f.status = 'scheduled'
     AND f.is_active = true
     AND f.departure_time > NOW()
   ORDER BY f.departure_time ASC
   LIMIT $4`;

const GET_POPULAR_FLIGHTS_GENERAL =
  `SELECT 
     f.*,
     a.name as airline_name,
     dep.code as departure_code,
     arr.code as arrival_code,
     'Chuyến bay hot nhất' as reason
   FROM flights f
   JOIN airlines a ON f.airline_id = a.id
   JOIN airports dep ON f.departure_airport_id = dep.id
   JOIN airports arr ON f.arrival_airport_id = arr.id
   LEFT JOIN bookings b ON b.outbound_flight_id = f.id
   WHERE f.status = 'scheduled'
     AND f.is_active = true
     AND f.departure_time > NOW()
   GROUP BY f.id, a.name, dep.code, arr.code
   ORDER BY COUNT(b.id) DESC, f.departure_time ASC
   LIMIT $1`;

const GET_POPULAR_FLIGHTS_ROUTE =
  `SELECT 
     f.*,
     a.name as airline_name,
     dep.code as departure_code,
     arr.code as arrival_code,
     'Chuyến bay phổ biến nhất' as reason
   FROM flights f
   JOIN airlines a ON f.airline_id = a.id
   JOIN airports dep ON f.departure_airport_id = dep.id
   JOIN airports arr ON f.arrival_airport_id = arr.id
   LEFT JOIN bookings b ON b.outbound_flight_id = f.id
   WHERE dep.code = $1 
     AND arr.code = $2
     AND f.status = 'scheduled'
     AND f.is_active = true
     AND f.departure_time > NOW()
   GROUP BY f.id, a.name, dep.code, arr.code
   ORDER BY COUNT(b.id) DESC, f.departure_time ASC
   LIMIT $3`;

// ── Public: Search Flights ─────────────────────────────────────────────────────
// (các query cũ của bạn giữ nguyên...)

module.exports = {
  // ... tất cả query cũ của bạn (COUNT_FLIGHTS, SELECT_FLIGHTS, ...)

  // Query recommendation mới
  GET_USER_BOOKED_FLIGHT_IDS,
  GET_HISTORY_RECOMMENDATIONS_GENERAL,
  GET_HISTORY_RECOMMENDATIONS_ROUTE,
  GET_POPULAR_FLIGHTS_GENERAL,
  GET_POPULAR_FLIGHTS_ROUTE,

  // các query khác...
};