"use strict";

/**
 * SQL queries liên quan đến bảng flights và flight_seats
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

// ── Seats ─────────────────────────────────────────────────────────────────────

const INSERT_FLIGHT_SEAT = `
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price, baggage_included_kg, carry_on_kg, extra_baggage_price)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  RETURNING *
`;

const SELECT_FLIGHT_SEAT_CLASS_INFO = `
  SELECT fs.*, f.flight_number, f.status as flight_status, f.departure_time,
         al.code as airline_code, al.name as airline_name,
         dep.code as departure_code, arr.code as arrival_code
  FROM flight_seats fs
  JOIN flights f ON f.id = fs.flight_id
  JOIN airlines al ON al.id = f.airline_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE fs.flight_id = $1
  ${1 ? "AND ($2::text IS NULL OR fs.class = $2)" : ""}
`;

// ── Flight by ID ──────────────────────────────────────────────────────────────

const SELECT_FLIGHT_BY_ID = `
  SELECT 
    f.*,
    al.code AS airline_code, al.name AS airline_name,
    dep.code AS departure_code, dep.city AS departure_city, dep.name AS departure_name,
    arr.code AS arrival_code, arr.city AS arrival_city, arr.name AS arrival_name
  FROM flights f
  JOIN airlines al ON al.id = f.airline_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE f.id = $1
`;

const SELECT_FLIGHTS_BY_IDS = `
  SELECT 
    f.*,
    al.code AS airline_code, al.name AS airline_name,
    dep.code AS departure_code, dep.city AS departure_city,
    arr.code AS arrival_code, arr.city AS arrival_city
  FROM flights f
  JOIN airlines al ON al.id = f.airline_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE f.id = ANY($1)
`;

// ── Search Flights ───────────────────────────────────────────────────────────

const SEARCH_FLIGHTS = (conditions, orderBy) => `
  SELECT 
    f.id AS flight_id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    f.status,
    al.id AS airline_id,
    al.code AS airline_code,
    al.name AS airline_name,
    dep.id AS departure_airport_id,
    dep.code AS departure_code,
    dep.city AS departure_city,
    dep.name AS departure_airport_name,
    arr.id AS arrival_airport_id,
    arr.code AS arrival_code,
    arr.city AS arrival_city,
    arr.name AS arrival_airport_name,
    fs.class AS seat_class,
    fs.total_seats,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.carry_on_kg,
    fs.extra_baggage_price
  FROM flights f
  JOIN airlines al ON al.id = f.airline_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  JOIN flight_seats fs ON fs.flight_id = f.id
  WHERE ${conditions}
  ORDER BY ${orderBy}
`;

const SEARCH_FLIGHTS_BASE = `
  SELECT 
    f.id AS flight_id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    f.status,
    al.id AS airline_id,
    al.code AS airline_code,
    al.name AS airline_name,
    dep.id AS departure_airport_id,
    dep.code AS departure_code,
    dep.city AS departure_city,
    dep.name AS departure_airport_name,
    arr.id AS arrival_airport_id,
    arr.code AS arrival_code,
    arr.city AS arrival_city,
    arr.name AS arrival_airport_name,
    fs.class AS seat_class,
    fs.total_seats,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.carry_on_kg,
    fs.extra_baggage_price
  FROM flights f
  JOIN airlines al ON al.id = f.airline_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  JOIN flight_seats fs ON fs.flight_id = f.id
  WHERE f.status = 'scheduled'
    AND f.is_active = true
    AND f.departure_time > NOW()
    AND dep.code = $1
    AND arr.code = $2
    AND fs.class = $3
    AND DATE(f.departure_time) = $4
    AND fs.available_seats >= $5
`;

// ── Alternative Flights ───────────────────────────────────────────────────────

const SEARCH_ALTERNATIVE_FLIGHTS = `
  SELECT 
    f.id AS flight_id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    al.code AS airline_code,
    al.name AS airline_name,
    dep.code AS departure_code,
    dep.city AS departure_city,
    arr.code AS arrival_code,
    arr.city AS arrival_city,
    fs.class AS seat_class,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.extra_baggage_price
  FROM flights f
  JOIN airlines al ON al.id = f.airline_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  JOIN flight_seats fs ON fs.flight_id = f.id
  WHERE f.status = 'scheduled'
    AND f.is_active = true
    AND f.departure_time > NOW()
    AND f.id != $1
    AND dep.code = $2
    AND arr.code = $3
    AND fs.class = $4
    AND fs.available_seats >= $5
    AND DATE(f.departure_time) = $6
  ORDER BY fs.base_price ASC
  LIMIT 5
`;

// ── Price Calendar ───────────────────────────────────────────────────────────

const GET_MIN_PRICES_CALENDAR = `
  SELECT 
    DATE(f.departure_time) AS flight_date,
    MIN(fs.base_price) AS min_price
  FROM flights f
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  JOIN flight_seats fs ON fs.flight_id = f.id
  WHERE f.status = 'scheduled'
    AND f.is_active = true
    AND f.departure_time > NOW()
    AND dep.code = $1
    AND arr.code = $2
    AND fs.class = $3
    AND DATE(f.departure_time) >= $4
    AND DATE(f.departure_time) <= $5
  GROUP BY DATE(f.departure_time)
  ORDER BY DATE(f.departure_time)
`;

// ── Airports & Airlines ──────────────────────────────────────────────────────

const SELECT_ALL_AIRPORTS = `
  SELECT id, code, name, city, country
  FROM airports
  WHERE is_active = true
  ORDER BY city
`;

const SELECT_ALL_AIRLINES = `
  SELECT id, code, name, logo_url
  FROM airlines
  WHERE is_active = true
  ORDER BY name
`;

// ── Recommendation Queries ────────────────────────────────────────────────────

const GET_USER_BOOKED_FLIGHT_IDS = `
  SELECT DISTINCT outbound_flight_id 
  FROM bookings 
  WHERE user_id = $1 AND status = 'confirmed'
`;

const GET_HISTORY_RECOMMENDATIONS_GENERAL = `
  SELECT 
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
  LIMIT $2
`;

const GET_HISTORY_RECOMMENDATIONS_ROUTE = `
  SELECT 
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
  LIMIT $4
`;

const GET_POPULAR_FLIGHTS_GENERAL = `
  SELECT 
    f.*,
    a.name as airline_name,
    dep.code as departure_code,
    arr.code as arrival_code,
    'Chuyến bay phổ biến' as reason
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
  LIMIT $1
`;

const GET_POPULAR_FLIGHTS_ROUTE = `
  SELECT 
    f.*,
    a.name as airline_name,
    dep.code as departure_code,
    arr.code as arrival_code,
    'Chuyến bay phổ biến' as reason
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
  LIMIT $3
`;

// ── Module Exports ────────────────────────────────────────────────────────────

// ── Module Exports ────────────────────────────────────────────────────────────
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

// ── Public: Flight Position / Tracker (SB-04) ────────────────────────────────

/**
 * Lấy tọa độ 2 sân bay và thông tin thời gian để tính vị trí máy bay realtime
 * $1 = flight_id
 */
const SELECT_FLIGHT_POSITION =
  `SELECT
     f.id,
     f.flight_number,
     f.departure_time,
     f.duration_minutes,
     f.status,
     dep.code AS dep_code,
     dep.city AS dep_city,
     dep.lat  AS dep_lat,
     dep.lng  AS dep_lng,
     arr.code AS arr_code,
     arr.city AS arr_city,
     arr.lat  AS arr_lat,
     arr.lng  AS arr_lng
   FROM flights f
   JOIN airports dep ON dep.id = f.departure_airport_id
   JOIN airports arr ON arr.id = f.arrival_airport_id
   WHERE f.id = $1`;

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
  // Admin
  COUNT_FLIGHTS,
  SELECT_FLIGHTS,

  // Seats
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
  SELECT_FLIGHT_POSITION,
  SELECT_SEAT_INFO,
  DECREASE_AVAILABLE_SEATS,
  INCREASE_AVAILABLE_SEATS,
  INSERT_FLIGHT_SEAT,
  SELECT_FLIGHT_SEAT_CLASS_INFO,
  SELECT_OCCUPIED_SEATS,

  // Flight by ID
  SELECT_FLIGHT_BY_ID,
  SELECT_FLIGHTS_BY_IDS,

  // Search
  SEARCH_FLIGHTS,
  SEARCH_FLIGHTS_BASE,
  SEARCH_ALTERNATIVE_FLIGHTS,
  GET_MIN_PRICES_CALENDAR,

  // Reference
  SELECT_ALL_AIRPORTS,
  SELECT_ALL_AIRLINES,

  // Recommendations
  GET_USER_BOOKED_FLIGHT_IDS,
  GET_HISTORY_RECOMMENDATIONS_GENERAL,
  GET_HISTORY_RECOMMENDATIONS_ROUTE,
  GET_POPULAR_FLIGHTS_GENERAL,
  GET_POPULAR_FLIGHTS_ROUTE,
};
