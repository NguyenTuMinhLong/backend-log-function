"use strict";

/**
 * SQL queries cho Recommendation Engine (CU-05 v4)
 * Dùng bảng sẵn có: holidays + holiday_rules
 *
 * 3 luồng:
 *   1. DAY_PATTERN  – theo ngày trong tuần user hay đặt nhất
 *   2. TIME_PROXIMITY – nhóm chuyến bay cách nhau ≤ 30 phút
 *   3. USER_HISTORY   – score địa điểm*5 + ngày*3 + giờ*1
 * Fallback: top_popular → top_searched
 */

// ─────────────────────────────────────────────
// LUỒNG 1: Ngày trong tuần user hay đặt nhất
// ─────────────────────────────────────────────
const SELECT_TOP_DAY_OF_WEEK = `
  SELECT
    EXTRACT(DOW FROM f.departure_time) AS day_of_week,
    COUNT(*) AS trip_count
  FROM bookings b
  JOIN flights f ON f.id = b.outbound_flight_id
  WHERE b.user_id = $1
    AND b.status IN ('confirmed', 'completed')
  GROUP BY day_of_week
  ORDER BY trip_count DESC
  LIMIT 1
`;

// ─────────────────────────────────────────────
// LUỒNG 1: Tất cả ngày trong tháng rơi vào topDayOfWeek
// ─────────────────────────────────────────────
const SELECT_DAYS_IN_MONTH = `
  SELECT
    TO_CHAR(d::DATE, 'YYYY-MM-DD') AS date_value,
    TO_CHAR(d::DATE, 'TMDay')     AS day_name,
    EXTRACT(DOW FROM d::DATE)     AS day_of_week
  FROM generate_series(
    DATE_TRUNC('month', $1::DATE),
    DATE_TRUNC('month', $1::DATE) + INTERVAL '1 month' - INTERVAL '1 day',
    INTERVAL '1 day'
  ) AS d
  WHERE EXTRACT(DOW FROM d::DATE) = $2
`;

// ─────────────────────────────────────────────
// LUỒNG 1: Chuyến bay vào ngày trùng topDayOfWeek trong tháng
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_BY_DAY_PATTERN = `
  SELECT
    f.id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    f.status,
    al.id               AS airline_id,
    al.code             AS airline_code,
    al.name             AS airline_name,
    al.logo_url         AS airline_logo,
    al.logo_dark        AS airline_logo_dark,
    al.logo_light       AS airline_logo_light,
    dep.id              AS departure_airport_id,
    dep.code            AS departure_code,
    dep.city            AS departure_city,
    dep.name            AS departure_airport_name,
    arr.id              AS arrival_airport_id,
    arr.code            AS arrival_code,
    arr.city            AS arrival_city,
    arr.name            AS arrival_airport_name,
    fs.class            AS seat_class,
    fs.total_seats,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.carry_on_kg,
    fs.extra_baggage_price,
    h.id                AS holiday_id,
    h.name              AS holiday_name,
    h.type              AS holiday_type,
    TO_CHAR(f.departure_time, 'TMDay') AS day_name
  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND DATE(f.departure_time) = ANY($1::date[])
    AND f.departure_time > NOW()
  ORDER BY f.departure_time
  LIMIT $2
`;

// ─────────────────────────────────────────────
// LUỒNG 2: Tất cả chuyến bay trong khoảng tháng (group 30p ở service)
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_FOR_TIME_GROUPING = `
  SELECT
    f.id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    f.status,
    al.id               AS airline_id,
    al.code             AS airline_code,
    al.name             AS airline_name,
    al.logo_url         AS airline_logo,
    al.logo_dark        AS airline_logo_dark,
    al.logo_light       AS airline_logo_light,
    dep.id              AS departure_airport_id,
    dep.code            AS departure_code,
    dep.city            AS departure_city,
    dep.name            AS departure_airport_name,
    arr.id              AS arrival_airport_id,
    arr.code            AS arrival_code,
    arr.city            AS arrival_city,
    arr.name            AS arrival_airport_name,
    fs.class            AS seat_class,
    fs.total_seats,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.carry_on_kg,
    fs.extra_baggage_price,
    h.id                AS holiday_id,
    h.name              AS holiday_name,
    h.type              AS holiday_type,
    hr.multiplier       AS price_multiplier
  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  LEFT JOIN holiday_rules hr
    ON (hr.date = DATE(f.departure_time)
        OR DATE(f.departure_time) BETWEEN hr.start_date AND hr.end_date)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time BETWEEN $1::TIMESTAMP AND $2::TIMESTAMP
  ORDER BY f.departure_time
`;

// ─────────────────────────────────────────────
// LUỒNG 3: Pattern địa điểm + ngày + giờ từ lịch sử booking
// ─────────────────────────────────────────────
const SELECT_USER_HISTORY_PATTERN = `
  SELECT
    dep.code                                    AS dep_code,
    arr.code                                    AS arr_code,
    EXTRACT(DOW FROM f.departure_time)        AS day_of_week,
    EXTRACT(HOUR FROM f.departure_time)::INT   AS dep_hour,
    COUNT(*)                                   AS trip_count
  FROM bookings b
  JOIN flights f ON f.id = b.outbound_flight_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE b.user_id = $1
    AND b.status IN ('confirmed', 'completed')
  GROUP BY dep.code, arr.code,
           EXTRACT(DOW FROM f.departure_time),
           EXTRACT(HOUR FROM f.departure_time)
  ORDER BY trip_count DESC
`;

// ─────────────────────────────────────────────
// LUỒNG 3: Chuyến bay phù hợp pattern cá nhân
// score = địa điểm*5 + ngày*3 + giờ*2
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_BY_USER_PATTERN = `
  SELECT
    f.id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    f.status,
    al.id               AS airline_id,
    al.code             AS airline_code,
    al.name             AS airline_name,
    al.logo_url         AS airline_logo,
    al.logo_dark        AS airline_logo_dark,
    al.logo_light       AS airline_logo_light,
    dep.id              AS departure_airport_id,
    dep.code            AS departure_code,
    dep.city            AS departure_city,
    dep.name            AS departure_airport_name,
    arr.id              AS arrival_airport_id,
    arr.code            AS arrival_code,
    arr.city            AS arrival_city,
    arr.name            AS arrival_airport_name,
    fs.class            AS seat_class,
    fs.total_seats,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.carry_on_kg,
    fs.extra_baggage_price,
    h.id                AS holiday_id,
    h.name              AS holiday_name,
    h.type              AS holiday_type,
    hr.multiplier       AS price_multiplier,

    (
      CASE WHEN arr.code = ANY($2) AND dep.code = ANY($3) THEN 5 ELSE 0 END
      + CASE WHEN EXTRACT(DOW FROM f.departure_time) = ANY($4::int[]) THEN 3 ELSE 0 END
      + CASE WHEN EXTRACT(HOUR FROM f.departure_time)::INT = ANY($5::int[]) THEN 2 ELSE 0 END
    ) AS score

  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  LEFT JOIN holiday_rules hr
    ON (hr.date = DATE(f.departure_time)
        OR DATE(f.departure_time) BETWEEN hr.start_date AND hr.end_date)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time BETWEEN $6::TIMESTAMP AND $7::TIMESTAMP
  ORDER BY score DESC, f.departure_time ASC
  LIMIT $8
`;

// ─────────────────────────────────────────────
// FALLBACK: Top popular flights (theo lượt đặt, LIMIT tăng lên)
// ─────────────────────────────────────────────
const SELECT_TOP_POPULAR_FLIGHTS = `
  SELECT
    f.id,
    f.flight_number,
    f.departure_time,
    f.arrival_time,
    f.duration_minutes,
    f.status,
    al.id               AS airline_id,
    al.code             AS airline_code,
    al.name             AS airline_name,
    al.logo_url         AS airline_logo,
    al.logo_dark        AS airline_logo_dark,
    al.logo_light       AS airline_logo_light,
    dep.id              AS departure_airport_id,
    dep.code            AS departure_code,
    dep.city            AS departure_city,
    dep.name            AS departure_airport_name,
    arr.id              AS arrival_airport_id,
    arr.code            AS arrival_code,
    arr.city            AS arrival_city,
    arr.name            AS arrival_airport_name,
    fs.class            AS seat_class,
    fs.total_seats,
    fs.available_seats,
    fs.base_price,
    fs.baggage_included_kg,
    fs.carry_on_kg,
    fs.extra_baggage_price,
    h.id                AS holiday_id,
    h.name              AS holiday_name,
    h.type              AS holiday_type,
    hr.multiplier       AS price_multiplier,
    COUNT(b.id)         AS booking_count
  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  LEFT JOIN holiday_rules hr
    ON (hr.date = DATE(f.departure_time)
        OR DATE(f.departure_time) BETWEEN hr.start_date AND hr.end_date)
  LEFT JOIN bookings b
    ON b.outbound_flight_id = f.id
    AND b.status IN ('confirmed', 'completed')
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time BETWEEN $1::TIMESTAMP AND $2::TIMESTAMP
  GROUP BY f.id, f.flight_number, f.departure_time, f.arrival_time,
           f.duration_minutes, f.status, al.id, al.code, al.name,
           al.logo_url, al.logo_dark, al.logo_light,
           dep.id, dep.code, dep.city, dep.name,
           arr.id, arr.code, arr.city, arr.name,
           fs.class, fs.total_seats, fs.available_seats,
           fs.base_price, fs.baggage_included_kg, fs.carry_on_kg, fs.extra_baggage_price,
           h.id, h.name, h.type,
           hr.multiplier
  ORDER BY booking_count DESC, f.departure_time ASC
  LIMIT $3
`;

// ─────────────────────────────────────────────
// FALLBACK: Top searched routes (cho user chưa có booking)
// ─────────────────────────────────────────────
const SELECT_TOP_SEARCHED_ROUTES = `
  SELECT
    sh.departure_code,
    sh.arrival_code,
    COUNT(*) AS search_count
  FROM search_history sh
  WHERE sh.user_id = $1
  GROUP BY sh.departure_code, sh.arrival_code
  ORDER BY search_count DESC
  LIMIT 5
`;

// ─────────────────────────────────────────────
// Lấy holidays trong khoảng tháng
// ─────────────────────────────────────────────
const SELECT_HOLIDAYS_IN_RANGE = `
  SELECT date, name, type
  FROM holidays
  WHERE date BETWEEN $1 AND $2
  ORDER BY date
`;

module.exports = {
  SELECT_TOP_DAY_OF_WEEK,
  SELECT_DAYS_IN_MONTH,
  SELECT_FLIGHTS_BY_DAY_PATTERN,
  SELECT_FLIGHTS_FOR_TIME_GROUPING,
  SELECT_USER_HISTORY_PATTERN,
  SELECT_FLIGHTS_BY_USER_PATTERN,
  SELECT_TOP_POPULAR_FLIGHTS,
  SELECT_TOP_SEARCHED_ROUTES,
  SELECT_HOLIDAYS_IN_RANGE,
};
