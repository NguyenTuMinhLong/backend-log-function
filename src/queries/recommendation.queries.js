"use strict";

/**
 * SQL queries cho Recommendation Service — CU-05
 * GET /api/flights/recommendations → recommendationService.getRecommendations()
 *
 * Tables:
 *   holidays:  id, name, date, year, month, day, multiplier, reason, is_active
 *   search_history: id, user_id, session_id, departure_code, arrival_code,
 *                  departure_date, return_date, seat_class, adults, children,
 *                  infants, results_count, min_price_found, created_at
 *
 * Logic:
 *   Step 1: Phân tích user preferences (search history + booking history)
 *   Step 2: Scored flights (route*50 + hour*30 + price*20 + day*40)
 *   Step 3: Recommendation groups (time proximity, day pattern)
 *   Step 4: Mix theo tier ưu tiên → final flights
 * Fallback: SELECT_TOP_BUY_DESTINATIONS khi không có lịch sử
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
// preferredRoutes: mảng route_key dạng 'SGN→HAN'
// preferredDestinations: mảng arr_code
// preferredDepartures: mảng dep_code
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_BY_DAY_PATTERN = (
  preferredRoutes = [],
  preferredDestinations = [],
  preferredDepartures = [],
) => {
  // dep ∈ preferredDepartures AND arr ∈ preferredDestinations (AND route khớp nếu có)
  const depDestCondition =
    preferredDepartures.length > 0 && preferredDestinations.length > 0
      ? `dep.code = ANY($${3}::text[]) AND arr.code = ANY($${4}::text[])`
      : (preferredDestinations.length > 0
        ? `arr.code = ANY($${3}::text[])` : "");

  const routeCondition = preferredRoutes.length > 0
    ? `(dep.code || '→' || arr.code) = ANY($${5}::text[])` : "";

  const conditions = [depDestCondition, routeCondition].filter(Boolean).join(" AND ");
  const whereExtra = conditions ? ` AND ${conditions}` : "";

  return `
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
    h.multiplier        AS holiday_multiplier,
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
    ${whereExtra}
    AND f.departure_time > NOW()
  ORDER BY f.departure_time
  LIMIT $2
`;
};

// ─────────────────────────────────────────────
// LUỒNG 2: Tất cả chuyến bay trong khoảng tháng, lọc theo preferred routes
// preferredRoutes: mảng route_key dạng 'SGN→HAN'
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_FOR_TIME_GROUPING = (preferredRoutes = [], preferredDestinations = [], preferredDepartures = []) => {
  const routeCondition =
    preferredRoutes.length > 0
      ? `(dep.code || '→' || arr.code) = ANY($${4}::text[])` : "";

  const depDestCondition =
    preferredDepartures.length > 0 && preferredDestinations.length > 0
      ? `dep.code = ANY($${5}::text[]) AND arr.code = ANY($${6}::text[])`
      : (preferredDestinations.length > 0
        ? `arr.code = ANY($${5}::text[])` : "");

  const conditions = [routeCondition, depDestCondition].filter(Boolean).join(" AND ");
  const whereExtra = conditions ? ` AND ${conditions}` : "";

  return `
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
    h.multiplier        AS holiday_multiplier
  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time BETWEEN $1::TIMESTAMP AND $2::TIMESTAMP
    ${whereExtra}
  ORDER BY f.departure_time
  LIMIT $3
`;
};

// ─────────────────────────────────────────────
// LUỒNG 3: Pattern địa điểm + ngày + giờ từ lịch sử booking
// ─────────────────────────────────────────────
const SELECT_USER_HISTORY_PATTERN = `
  SELECT
    dep.code                                    AS dep_code,
    arr.code                                    AS arr_code,
    EXTRACT(DOW FROM f.departure_time)        AS day_of_week,
    EXTRACT(HOUR FROM f.departure_time)::INT AS dep_hour,
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
// score = địa điểm×5 + ngày×3 + giờ×2 (theo spec)
// preferredDOWs: mảng int[], preferredHours: mảng int[]
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_BY_USER_PATTERN = (
  preferredDestinations,
  preferredDepartures,
  preferredDOWs   = [],
  preferredHours  = [],
  start,
  end,
  limit,
) => {
  const dowCondition   = preferredDOWs.length > 0
    ? `((EXTRACT(DOW FROM f.departure_time) + 6) % 7) = ANY($${4}::int[])` : "TRUE";
  // preferredHours là giờ local VN (14) → UTC hour = 7 → convert UTC→VN: +7 % 24
  const hourCondition = preferredHours.length > 0
    ? `((EXTRACT(HOUR FROM f.departure_time) + 7) % 24) = ANY($${5}::int[])` : "TRUE";
  const paramCount = 7; // total positional params: $1..$7

  return `
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
    h.multiplier        AS holiday_multiplier,

    (
      CASE WHEN arr.code = ANY($${1}) AND dep.code = ANY($${2}) THEN 5 ELSE 0 END
      + CASE WHEN ${dowCondition} THEN 3 ELSE 0 END
      + CASE WHEN ${hourCondition} THEN 2 ELSE 0 END
    ) AS score

  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time BETWEEN $${6}::TIMESTAMP AND $${7}::TIMESTAMP
  ORDER BY score DESC, f.departure_time ASC
  LIMIT $${paramCount}
`;
};

// ─────────────────────────────────────────────
// FALLBACK: Top popular flights
// ─────────────────────────────────────────────
const SELECT_TOP_POPULAR_FLIGHTS = (start, end, limit, preferredDestinations = []) => {
  const destFilter = preferredDestinations.length > 0
    ? `AND arr.code = ANY($${4}::text[])`
    : "";

  return `
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
    h.multiplier        AS holiday_multiplier,
    COUNT(b.id)         AS booking_count
  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  LEFT JOIN bookings b
    ON b.outbound_flight_id = f.id
    AND b.status IN ('confirmed', 'completed')
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time BETWEEN $1::TIMESTAMP AND $2::TIMESTAMP
    ${destFilter}
  GROUP BY f.id, f.flight_number, f.departure_time, f.arrival_time,
           f.duration_minutes, f.status, al.id, al.code, al.name,
           al.logo_url, al.logo_dark, al.logo_light,
           dep.id, dep.code, dep.city, dep.name,
           arr.id, arr.code, arr.city, arr.name,
           fs.class, fs.total_seats, fs.available_seats,
           fs.base_price, fs.baggage_included_kg, fs.carry_on_kg, fs.extra_baggage_price,
           h.id, h.name, h.multiplier
  ORDER BY booking_count DESC, f.departure_time ASC
  LIMIT $3
`;
};

// ─────────────────────────────────────────────
// FALLBACK: Top searched routes
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
// FALLBACK: Flights matching user's top searched routes
// ─────────────────────────────────────────────
const SELECT_FLIGHTS_BY_SEARCH_PATTERN = `
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
    h.multiplier        AS holiday_multiplier
  FROM flights f
  JOIN airlines  al  ON al.id = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND dep.code = ANY($1)
    AND arr.code = ANY($2)
    AND f.departure_time BETWEEN $3::TIMESTAMP AND $4::TIMESTAMP
  ORDER BY f.departure_time ASC
  LIMIT $5
`;

// ─────────────────────────────────────────────
// Lấy holidays trong khoảng tháng
// ─────────────────────────────────────────────
const SELECT_HOLIDAYS_IN_RANGE = `
  SELECT date, name, multiplier
  FROM holidays
  WHERE date BETWEEN $1 AND $2
  ORDER BY date
`;

// ─────────────────────────────────────────────
// RECOMMENDATION.SERVICE — getRecommendations (Lịch sử tìm kiếm theo user)
// ─────────────────────────────────────────────
const SELECT_SEARCH_HISTORY_BY_USER = `
  SELECT
    sh.arrival_code,
    sh.departure_code,
    AVG(sh.min_price_found) AS avg_min_price
  FROM search_history sh
  WHERE sh.user_id = $1
  GROUP BY sh.arrival_code, sh.departure_code
  ORDER BY COUNT(*) DESC
  LIMIT 20
`;

// ─────────────────────────────────────────────
// RECOMMENDATION.SERVICE — getRecommendations (Lịch sử tìm kiếm theo guest session)
// ─────────────────────────────────────────────
const SELECT_SEARCH_HISTORY_BY_SESSION = `
  SELECT
    sh.arrival_code,
    sh.departure_code,
    AVG(sh.min_price_found) AS avg_min_price
  FROM search_history sh
  WHERE sh.session_id = $1
  GROUP BY sh.arrival_code, sh.departure_code
  ORDER BY COUNT(*) DESC
  LIMIT 20
`;

// ─────────────────────────────────────────────
// RECOMMENDATION.SERVICE — getRecommendations (Lịch sử booking preferences)
// Trả về route cụ thể dep→arr (VD: 'SGN→HAN') để ưu tiên đúng tuyến user hay đặt.
// Lấy cả avg_dep_hour và preferred_day như trước.
// ─────────────────────────────────────────────
const SELECT_BOOKING_HISTORY_PREFERENCES = `
  SELECT
    dep.code                                      AS dep_code,
    arr.code                                      AS arr_code,
    (dep.code || '→' || arr.code)                AS route_key,
    AVG(EXTRACT(HOUR FROM f.departure_time))::INT AS avg_dep_hour,
    MODE() WITHIN GROUP (
      ORDER BY EXTRACT(DAY FROM f.departure_time)::INT
    )                                             AS preferred_day,
    MODE() WITHIN GROUP (
      ORDER BY EXTRACT(DOW FROM f.departure_time)::INT
    )                                             AS preferred_dow,
    AVG(fs.base_price)                            AS avg_price,
    COUNT(*)                                      AS trip_count
  FROM bookings b
  JOIN flights f         ON f.id = b.outbound_flight_id
  JOIN airports arr      ON arr.id = f.arrival_airport_id
  JOIN airports dep      ON dep.id = f.departure_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  WHERE b.user_id = $1
    AND b.status IN ('confirmed', 'completed')
  GROUP BY dep.code, arr.code
  ORDER BY trip_count DESC
  LIMIT 10
`;

// ─────────────────────────────────────────────
// RECOMMENDATION.SERVICE — getRecommendations (Fallback TopBuy khi không có lịch sử)
// ─────────────────────────────────────────────
const SELECT_TOP_BUY_DESTINATIONS = `
  SELECT
    arr.code AS arr_code,
    COUNT(*) AS booking_count
  FROM bookings b
  JOIN flights f  ON f.id = b.outbound_flight_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE b.status IN ('confirmed', 'completed')
  GROUP BY arr.code
  ORDER BY booking_count DESC
  LIMIT 10
`;

// ─────────────────────────────────────────────
// RECOMMENDATION.SERVICE — getRecommendations (Scored flights theo sở thích)
// extraOrder: chuỗi 'ORDER BY col ASC/DESC,' để thêm vào ORDER BY chính
// extraFilter: chuỗi điều kiện 'AND ...' để thêm vào WHERE
// preferredRoutes: mảng route_key dạng 'SGN→HAN', thưởng +60 khi cả dep và arr khớp
// ─────────────────────────────────────────────
const SELECT_SCORED_FLIGHTS = (
  extraOrder = "",
  extraFilter = "",
  fromAirport = null,
  toAirport = null,
  preferredRoutes = [],
) => {
  // Parameterized to prevent SQL injection (was: template literals)
  const depCondition = fromAirport ? `AND dep.code = $9` : "";
  const arrCondition = toAirport   ? `AND arr.code = $10` : "";

  return `
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
    h.multiplier        AS holiday_multiplier,
    (
      -- Fix (c): Route cụ thể khớp hoàn toàn dep+arr → +60 điểm cao nhất
      CASE WHEN (dep.code || '→' || arr.code) = ANY($6::text[]) THEN 60 ELSE 0 END
      -- Chỉ điểm đến khớp khi không có route cụ thể khớp (tránh trùng)
      + CASE WHEN arr.code = ANY($2) AND (dep.code || '→' || arr.code) != ALL(COALESCE($6::text[], ARRAY[]::text[])) THEN 50 ELSE 0 END
      + CASE WHEN dep.code = ANY($3) THEN 20 ELSE 0 END
      + CASE WHEN $5::int[] <> ARRAY[]::int[] AND EXTRACT(DAY FROM f.departure_time)::INT = ANY($5::int[]) THEN 40 ELSE 0 END
      -- PostgreSQL DOW: 0=Sun,...,6=Sat → chuyển về JS convention: 0=Mon,...,6=Sun
      + CASE WHEN $7::int[] <> ARRAY[]::int[] AND ((EXTRACT(DOW FROM f.departure_time) + 6) % 7) = ANY($7::int[]) THEN 35 ELSE 0 END
      -- Giờ so sánh: preferredHours lưu theo giờ local VN → convert UTC hour về local VN
      + CASE WHEN $8::int[] <> ARRAY[]::int[] AND ((EXTRACT(HOUR FROM f.departure_time) + 7) % 24) = ANY($8::int[]) THEN 30 ELSE 0 END
      + CASE WHEN ABS(fs.base_price - $4) <= 1000000 THEN 20 ELSE 0 END
    ) AS score
  FROM flights f
  JOIN airlines  al  ON al.id  = f.airline_id
  JOIN airports   dep ON dep.id = f.departure_airport_id
  JOIN airports   arr ON arr.id = f.arrival_airport_id
  LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
  LEFT JOIN holidays h ON h.date = DATE(f.departure_time)
  WHERE f.status = 'scheduled'
    AND f.is_active = TRUE
    AND fs.available_seats > 0
    AND f.departure_time > NOW()
    ${depCondition}
    ${arrCondition}
    ${extraFilter}
  ORDER BY score DESC, ${extraOrder} f.departure_time ASC
  LIMIT $1
`;
};

// ─────────────────────────────────────────────
// FLIGHT.SERVICE — Lưu lịch sử tìm kiếm
// ─────────────────────────────────────────────
const INSERT_SEARCH_HISTORY = `
  INSERT INTO search_history
    (user_id, session_id, departure_code, arrival_code,
     departure_date, return_date, seat_class, adults, children, infants,
     results_count, min_price_found)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
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
  SELECT_FLIGHTS_BY_SEARCH_PATTERN,
  SELECT_HOLIDAYS_IN_RANGE,
  // recommendation.service — getRecommendations
  SELECT_SEARCH_HISTORY_BY_USER,
  SELECT_SEARCH_HISTORY_BY_SESSION,
  SELECT_BOOKING_HISTORY_PREFERENCES,
  SELECT_TOP_BUY_DESTINATIONS,
  SELECT_SCORED_FLIGHTS,
  INSERT_SEARCH_HISTORY,
};
