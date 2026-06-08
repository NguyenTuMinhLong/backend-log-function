"use strict";

/**
 * SQL queries cho recommendation system (CU-05)
 * - search_history: lưu + đọc lịch sử tìm kiếm
 * - booking_history: lấy lịch sử booking để phân tích preference
 * - top_buy: fallback khi chưa có lịch sử
 * - scored_flights: query chính với scoring
 */

// ── Search History ───────────────────────────────────────────────────────────

const INSERT_SEARCH_HISTORY = `
  INSERT INTO search_history (
    user_id, session_id,
    departure_code, arrival_code, departure_date, return_date,
    seat_class, adults, children, infants,
    results_count, min_price_found
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
`;

const SELECT_SEARCH_HISTORY_BY_USER = `
  SELECT
    arrival_code,
    departure_code,
    COUNT(*)             AS search_count,
    AVG(min_price_found) AS avg_min_price
  FROM search_history
  WHERE user_id = $1
  GROUP BY arrival_code, departure_code
  ORDER BY search_count DESC
  LIMIT 5
`;

const SELECT_SEARCH_HISTORY_BY_SESSION = `
  SELECT
    arrival_code,
    departure_code,
    COUNT(*)             AS search_count,
    AVG(min_price_found) AS avg_min_price
  FROM search_history
  WHERE session_id = $1
  GROUP BY arrival_code, departure_code
  ORDER BY search_count DESC
  LIMIT 5
`;

// ── Booking History ──────────────────────────────────────────────────────────

const SELECT_BOOKING_HISTORY_PREFERENCES = `
  SELECT
    arr.code                                          AS arr_code,
    dep.code                                          AS dep_code,
    COUNT(*)                                          AS trip_count,
    AVG(b.total_price)                                AS avg_price,
    AVG(EXTRACT(HOUR FROM f.departure_time))          AS avg_dep_hour,
    MODE() WITHIN GROUP (
      ORDER BY EXTRACT(DAY FROM f.departure_time)
    )                                                  AS preferred_day
  FROM bookings b
  JOIN flights  f   ON f.id   = b.outbound_flight_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE b.user_id = $1
    AND b.status IN ('confirmed', 'completed')
  GROUP BY arr.code, dep.code
  ORDER BY trip_count DESC
  LIMIT 5
`;

// ── TopBuy Fallback ─────────────────────────────────────────────────────────

const SELECT_TOP_BUY_DESTINATIONS = `
  SELECT
    dep.code  AS dep_code,
    arr.code  AS arr_code,
    COUNT(b.id) AS booking_count
  FROM bookings b
  JOIN flights  f   ON f.id   = b.outbound_flight_id
  JOIN airports dep ON dep.id = f.departure_airport_id
  JOIN airports arr ON arr.id = f.arrival_airport_id
  WHERE b.status IN ('confirmed', 'completed')
    AND f.departure_time > NOW()
  GROUP BY dep.code, arr.code
  ORDER BY booking_count DESC
  LIMIT 5
`;

// ── Scored Flights (main recommendation query) ───────────────────────────────
//
// params: $1=limit, $2=preferred_destinations[], $3=preferred_hour, $4=avg_spending
// extra: extraFilter, extraOrder, fromAirport, toAirport (injected via string concat
//        because PostgreSQL doesn't support dynamic column filters in parameterized form)

const SELECT_SCORED_FLIGHTS = (
  extraOrder = "",
  extraFilter = "",
  fromAirport = null,
  toAirport = null,
) => {
  const fromFilter = fromAirport ? `AND dep.code = '${fromAirport}'` : "";
  const toFilter   = toAirport   ? `AND arr.code = '${toAirport}'`   : "";

  return `
    SELECT
      f.id                AS flight_id,
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

      (
        -- Điểm đến yêu thích
        + CASE WHEN arr.code = ANY($2) THEN 30 ELSE 0 END

        -- Khung giờ theo thói quen thực tế (±2h)
        + CASE WHEN ABS(EXTRACT(HOUR FROM f.departure_time) - $3) <= 2
                 AND $3 > 0 THEN 15
               WHEN EXTRACT(HOUR FROM f.departure_time) BETWEEN 5 AND 11
                 AND $3 = 0  THEN 10
               ELSE 0 END

        -- Bay thẳng (không quá cảnh, < 5h)
        + CASE WHEN f.duration_minutes < 300 THEN 15 ELSE 0 END

        -- Chuyến đêm trừ điểm
        + CASE WHEN EXTRACT(HOUR FROM f.departure_time) >= 22
                 OR EXTRACT(HOUR FROM f.departure_time) <= 4  THEN -10 ELSE 0 END

        -- Ngân sách phù hợp với mức chi trung bình của user
        + CASE WHEN fs.base_price <= ($4 * 1.2) AND $4 > 0 THEN 10
               WHEN fs.base_price < 5000000 AND $4 = 0 THEN 15
               ELSE 0 END

        -- Đầu tháng bonus (ngày 1-7)
        + CASE WHEN EXTRACT(DAY FROM f.departure_time) BETWEEN 1 AND 7 THEN 5 ELSE 0 END
      ) AS score

    FROM flights f
    JOIN airlines al  ON al.id  = f.airline_id
    JOIN airports dep ON dep.id = f.departure_airport_id
    JOIN airports arr ON arr.id = f.arrival_airport_id
    LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'

    WHERE f.status           = 'scheduled'
      AND f.is_active        = TRUE
      AND fs.available_seats > 0
      AND f.departure_time BETWEEN NOW() - INTERVAL '3 hours'
                                AND NOW() + INTERVAL '10 days'
      ${extraFilter}
      ${fromFilter}
      ${toFilter}

    ORDER BY ${extraOrder} score DESC, f.departure_time ASC
    LIMIT $1
  `;
};

// ── Module Exports ───────────────────────────────────────────────────────────

module.exports = {
  // Search History
  INSERT_SEARCH_HISTORY,
  SELECT_SEARCH_HISTORY_BY_USER,
  SELECT_SEARCH_HISTORY_BY_SESSION,

  // Booking History
  SELECT_BOOKING_HISTORY_PREFERENCES,

  // Fallback
  SELECT_TOP_BUY_DESTINATIONS,

  // Recommendation
  SELECT_SCORED_FLIGHTS,
};
