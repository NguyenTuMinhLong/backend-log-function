"use strict";

/**
 * SQL queries liên quan đến bảng flights và flight_seats
 * Được dùng bởi: admin.flight.service.js, flight.service.js, booking.service.js
 */

// ── Admin: Flights ─────────────────────────────────────────────────────────────

const COUNT_FLIGHTS = (whereClause) =>
  `SELECT COUNT(*) FROM flights f
   JOIN airlines al  ON al.id  = f.airline_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   ${whereClause}`;

const SELECT_FLIGHTS = (whereClause, limitIdx, offsetIdx) =>
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
   ${whereClause}
   GROUP BY f.id, al.id, al.code, al.name,
            dep.id, dep.code, dep.city,
            arr.id, arr.code, arr.city
   ORDER BY f.departure_time ASC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

const FIND_FLIGHT_BY_ID =
  `SELECT * FROM flights WHERE id = $1`;

const INSERT_FLIGHT =
  `INSERT INTO flights (
     flight_number, airline_id,
     departure_airport_id, arrival_airport_id,
     departure_time, arrival_time,
     duration_minutes, status
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'scheduled')
   RETURNING *`;

const INSERT_FLIGHT_SEAT =
  `INSERT INTO flight_seats (
     flight_id, class, total_seats, available_seats, base_price,
     baggage_included_kg, carry_on_kg, extra_baggage_price
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;

const UPDATE_FLIGHT_FIELDS = (fields, idx) =>
  `UPDATE flights SET ${fields.join(", ")} WHERE id = $${idx}`;

const FIND_FLIGHT_SEAT =
  `SELECT id FROM flight_seats WHERE flight_id = $1 AND class = $2`;

const UPDATE_FLIGHT_SEAT_FIELDS = (seatFields, sidx) =>
  `UPDATE flight_seats SET ${seatFields.join(", ")}
   WHERE flight_id = $${sidx} AND class = $${sidx + 1}`;

// Dùng khi INSERT seat trong updateFlight (available_seats = total_seats)
const INSERT_FLIGHT_SEAT_UPSERT =
  `INSERT INTO flight_seats (
     flight_id, class, total_seats, available_seats, base_price,
     baggage_included_kg, carry_on_kg, extra_baggage_price
   ) VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`;

const UPDATE_FLIGHT_STATUS =
  `UPDATE flights SET status = $1, updated_at = NOW() WHERE id = $2
   RETURNING id, flight_number, status`;

const FIND_FLIGHT_VISIBILITY =
  `SELECT id, flight_number, is_active FROM flights WHERE id = $1`;

const SET_FLIGHT_VISIBILITY =
  `UPDATE flights SET is_active = $1, updated_at = NOW() WHERE id = $2`;

// ── Public: Search Flights ─────────────────────────────────────────────────────

const SEARCH_FLIGHTS = (whereClause, orderBy) =>
  `SELECT
     f.id                    AS flight_id,
     f.flight_number,
     f.departure_time,
     f.arrival_time,
     f.duration_minutes,
     f.status,
     al.id                   AS airline_id,
     al.code                 AS airline_code,
     al.name                 AS airline_name,
     al.logo_url             AS airline_logo,
     dep_ap.id               AS departure_airport_id,
     dep_ap.code             AS departure_code,
     dep_ap.name             AS departure_airport_name,
     dep_ap.city             AS departure_city,
     arr_ap.id               AS arrival_airport_id,
     arr_ap.code             AS arrival_code,
     arr_ap.name             AS arrival_airport_name,
     arr_ap.city             AS arrival_city,
     fs.class                AS seat_class,
     fs.available_seats,
     fs.total_seats,
     fs.base_price,
     fs.baggage_included_kg,
     fs.carry_on_kg,
     fs.extra_baggage_price
   FROM flights f
   JOIN airlines     al     ON al.id     = f.airline_id
   JOIN airports     dep_ap ON dep_ap.id = f.departure_airport_id
   JOIN airports     arr_ap ON arr_ap.id = f.arrival_airport_id
   JOIN flight_seats fs     ON fs.flight_id = f.id
   WHERE ${whereClause}
   ORDER BY ${orderBy}`;

const SELECT_FLIGHT_BY_ID =
  `SELECT
     f.id, f.flight_number, f.departure_time, f.arrival_time,
     f.duration_minutes, f.status,
     al.code AS airline_code, al.name AS airline_name, al.logo_url,
     dep.code AS departure_code, dep.name AS departure_name, dep.city AS departure_city,
     arr.code AS arrival_code,  arr.name AS arrival_name,  arr.city AS arrival_city,
     json_agg(
       json_build_object(
         'class',               fs.class,
         'available_seats',     fs.available_seats,
         'total_seats',         fs.total_seats,
         'base_price',          fs.base_price,
         'baggage_included_kg', fs.baggage_included_kg,
         'carry_on_kg',         fs.carry_on_kg,
         'extra_baggage_price', fs.extra_baggage_price
       ) ORDER BY fs.base_price
     ) AS seats
   FROM flights f
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   JOIN flight_seats fs  ON fs.flight_id = f.id
   WHERE f.id = $1
   GROUP BY f.id, al.code, al.name, al.logo_url,
            dep.code, dep.name, dep.city,
            arr.code, arr.name, arr.city`;

// ── Public: Alternative Flights (SB-01) ───────────────────────────────────────

/**
 * Lấy thông tin chi tiết chuyến bay gốc kèm thông tin ghế theo class
 * $1 = flight_id, $2 = seat_class
 */
const SELECT_ORIGINAL_FLIGHT =
  `SELECT
     f.id               AS flight_id,
     f.flight_number,
     f.departure_time,
     f.arrival_time,
     f.duration_minutes,
     f.status,
     al.id              AS airline_id,
     al.code            AS airline_code,
     al.name            AS airline_name,
     al.logo_url        AS airline_logo,
     dep.id             AS departure_airport_id,
     dep.code           AS departure_code,
     dep.name           AS departure_airport_name,
     dep.city           AS departure_city,
     arr.id             AS arrival_airport_id,
     arr.code           AS arrival_code,
     arr.name           AS arrival_airport_name,
     arr.city           AS arrival_city,
     fs.class           AS seat_class,
     fs.available_seats,
     fs.total_seats,
     fs.base_price,
     fs.baggage_included_kg,
     fs.carry_on_kg,
     fs.extra_baggage_price
   FROM flights f
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = $2
   WHERE f.id = $1`;

/**
 * Tìm chuyến bay cùng tuyến cùng ngày còn ghế, loại trừ chuyến gốc
 * $1=excl_flight_id $2=dep_airport_id $3=arr_airport_id $4=dep_date $5=seat_class $6=seats_needed
 */
const SELECT_SAME_ROUTE_ALTERNATIVES =
  `SELECT
     f.id               AS flight_id,
     f.flight_number,
     f.departure_time,
     f.arrival_time,
     f.duration_minutes,
     f.status,
     al.id              AS airline_id,
     al.code            AS airline_code,
     al.name            AS airline_name,
     al.logo_url        AS airline_logo,
     dep.id             AS departure_airport_id,
     dep.code           AS departure_code,
     dep.name           AS departure_airport_name,
     dep.city           AS departure_city,
     arr.id             AS arrival_airport_id,
     arr.code           AS arrival_code,
     arr.name           AS arrival_airport_name,
     arr.city           AS arrival_city,
     fs.class           AS seat_class,
     fs.available_seats,
     fs.total_seats,
     fs.base_price,
     fs.baggage_included_kg,
     fs.carry_on_kg,
     fs.extra_baggage_price
   FROM flights f
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   JOIN flight_seats fs  ON fs.flight_id = f.id AND fs.class = $5
   WHERE f.id                   != $1
     AND f.departure_airport_id  = $2
     AND f.arrival_airport_id    = $3
     AND DATE(f.departure_time)  = $4
     AND fs.available_seats      >= $6
     AND f.status                = 'scheduled'
     AND f.is_active             = TRUE
   ORDER BY fs.base_price ASC`;

/**
 * Tìm chuyến bay có quá cảnh (1 điểm dừng) rẻ hơn chuyến gốc
 * $1=dep_airport_id $2=arr_airport_id $3=dep_date $4=seat_class $5=seats_needed $6=price_limit
 */
const SELECT_LAYOVER_FLIGHTS =
  `SELECT
     f1.id              AS leg1_flight_id,
     f1.flight_number   AS leg1_flight_number,
     f1.departure_time  AS leg1_departure_time,
     f1.arrival_time    AS leg1_arrival_time,
     f1.duration_minutes AS leg1_duration_minutes,
     al1.id             AS leg1_airline_id,
     al1.code           AS leg1_airline_code,
     al1.name           AS leg1_airline_name,
     al1.logo_url       AS leg1_airline_logo,
     fs1.available_seats AS leg1_available_seats,
     fs1.base_price     AS leg1_base_price,
     fs1.baggage_included_kg AS leg1_baggage_included_kg,
     fs1.carry_on_kg    AS leg1_carry_on_kg,
     fs1.extra_baggage_price AS leg1_extra_baggage_price,
     hub.id             AS hub_airport_id,
     hub.code           AS hub_code,
     hub.name           AS hub_name,
     hub.city           AS hub_city,
     f2.id              AS leg2_flight_id,
     f2.flight_number   AS leg2_flight_number,
     f2.departure_time  AS leg2_departure_time,
     f2.arrival_time    AS leg2_arrival_time,
     f2.duration_minutes AS leg2_duration_minutes,
     al2.id             AS leg2_airline_id,
     al2.code           AS leg2_airline_code,
     al2.name           AS leg2_airline_name,
     al2.logo_url       AS leg2_airline_logo,
     fs2.available_seats AS leg2_available_seats,
     fs2.base_price     AS leg2_base_price,
     fs2.baggage_included_kg AS leg2_baggage_included_kg,
     fs2.carry_on_kg    AS leg2_carry_on_kg,
     fs2.extra_baggage_price AS leg2_extra_baggage_price,
     (fs1.base_price + fs2.base_price) AS combined_base_price,
     EXTRACT(EPOCH FROM (f2.departure_time - f1.arrival_time)) / 60 AS layover_minutes
   FROM flights f1
   JOIN airlines     al1 ON al1.id = f1.airline_id
   JOIN airports     hub ON hub.id = f1.arrival_airport_id
   JOIN flight_seats fs1 ON fs1.flight_id = f1.id AND fs1.class = $4
   JOIN flights      f2  ON f2.departure_airport_id = hub.id
                         AND f2.arrival_airport_id   = $2
                         AND DATE(f2.departure_time)  = $3
   JOIN airlines     al2 ON al2.id = f2.airline_id
   JOIN flight_seats fs2 ON fs2.flight_id = f2.id AND fs2.class = $4
   WHERE f1.departure_airport_id  = $1
     AND DATE(f1.departure_time)  = $3
     AND f1.status = 'scheduled'  AND f1.is_active = TRUE
     AND f2.status = 'scheduled'  AND f2.is_active = TRUE
     AND fs1.available_seats      >= $5
     AND fs2.available_seats      >= $5
     AND hub.id != $1
     AND hub.id != $2
     AND f2.departure_time > f1.arrival_time + INTERVAL '1 hour'
     AND f2.departure_time < f1.arrival_time + INTERVAL '8 hours'
     AND (fs1.base_price + fs2.base_price) < $6
   ORDER BY combined_base_price ASC
   LIMIT 5`;

// ── Public: Price Calendar (SB-02) ────────────────────────────────────────────

/**
 * Lấy giá vé thấp nhất mỗi ngày trong khoảng thời gian cho một tuyến bay
 * $1=departure_code $2=arrival_code $3=date_from $4=date_to $5=seat_class $6=seats_needed
 */
const SELECT_PRICE_CALENDAR =
  `SELECT
     DATE(f.departure_time)  AS flight_date,
     MIN(fs.base_price)      AS min_price,
     COUNT(f.id)             AS flight_count
   FROM flights f
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   JOIN flight_seats fs  ON fs.flight_id = f.id AND fs.class = $5
   WHERE UPPER(dep.code)         = UPPER($1)
     AND UPPER(arr.code)         = UPPER($2)
     AND DATE(f.departure_time) >= $3
     AND DATE(f.departure_time) <= $4
     AND fs.available_seats      >= $6
     AND f.status                = 'scheduled'
     AND f.is_active             = TRUE
   GROUP BY DATE(f.departure_time)
   ORDER BY flight_date ASC`;

// ── Public: Seat Map (SB-03) ──────────────────────────────────────────────────

/**
 * Lấy thông tin ghế (tổng số, class) của một chuyến bay theo class
 * $1=flight_id, $2=seat_class (optional – nếu NULL lấy tất cả class)
 */
const SELECT_FLIGHT_SEAT_CLASS_INFO =
  `SELECT
     fs.class,
     fs.total_seats,
     fs.available_seats,
     fs.base_price,
     fs.baggage_included_kg,
     fs.carry_on_kg,
     f.flight_number,
     f.status        AS flight_status,
     f.departure_time,
     al.name         AS airline_name,
     al.code         AS airline_code,
     dep.code        AS departure_code,
     arr.code        AS arrival_code
   FROM flight_seats fs
   JOIN flights  f   ON f.id   = fs.flight_id
   JOIN airlines al  ON al.id  = f.airline_id
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   WHERE fs.flight_id = $1
     AND ($2::VARCHAR IS NULL OR fs.class = $2)
   ORDER BY
     CASE fs.class WHEN 'first' THEN 1 WHEN 'business' THEN 2 ELSE 3 END`;

/**
 * Lấy danh sách ghế đã được gán (occupied) cho chuyến bay theo class
 * $1=flight_id, $2=seat_class (optional)
 */
const SELECT_OCCUPIED_SEATS =
  `SELECT seat_number, class, status
   FROM flight_seat_assignments
   WHERE flight_id = $1
     AND ($2::VARCHAR IS NULL OR class = $2)
   ORDER BY seat_number`;

// ── Booking: Seat info ─────────────────────────────────────────────────────────

const SELECT_SEAT_INFO =
  `SELECT fs.base_price, fs.available_seats, fs.total_seats,
          fs.baggage_included_kg, fs.carry_on_kg, fs.extra_baggage_price,
          f.status, f.departure_time
   FROM flight_seats fs
   JOIN flights f ON f.id = fs.flight_id
   WHERE fs.flight_id = $1 AND fs.class = $2`;

const DECREASE_AVAILABLE_SEATS =
  `UPDATE flight_seats
   SET available_seats = available_seats - $1, updated_at = NOW()
   WHERE flight_id = $2 AND class = $3`;

const INCREASE_AVAILABLE_SEATS =
  `UPDATE flight_seats
   SET available_seats = available_seats + $1, updated_at = NOW()
   WHERE flight_id = $2 AND class = $3`;

module.exports = {
  COUNT_FLIGHTS,
  SELECT_FLIGHTS,
  FIND_FLIGHT_BY_ID,
  INSERT_FLIGHT,
  INSERT_FLIGHT_SEAT,
  UPDATE_FLIGHT_FIELDS,
  FIND_FLIGHT_SEAT,
  UPDATE_FLIGHT_SEAT_FIELDS,
  INSERT_FLIGHT_SEAT_UPSERT,
  UPDATE_FLIGHT_STATUS,
  FIND_FLIGHT_VISIBILITY,
  SET_FLIGHT_VISIBILITY,
  SEARCH_FLIGHTS,
  SELECT_FLIGHT_BY_ID,
  SELECT_ORIGINAL_FLIGHT,
  SELECT_SAME_ROUTE_ALTERNATIVES,
  SELECT_LAYOVER_FLIGHTS,
  SELECT_PRICE_CALENDAR,
  SELECT_FLIGHT_SEAT_CLASS_INFO,
  SELECT_OCCUPIED_SEATS,
  SELECT_SEAT_INFO,
  DECREASE_AVAILABLE_SEATS,
  INCREASE_AVAILABLE_SEATS,
};
