/**
 * SQL queries cho multi-leg cross-airline flight search
 * Dùng chung với flight.queries.js gốc
 */

// Layover tối thiểu 45 phút, tối đa 8 tiếng
const MIN_LAYOVER_MINUTES = 45;
const MAX_LAYOVER_HOURS = 8;

// Tim chuyen bay truc tiep (0 stop)
const FIND_DIRECT_FLIGHTS = `
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
    al.logo_url AS airline_logo,
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
    AND dep.code = $1              -- Tu san bay
    AND arr.code = $2              -- Den san bay
    AND fs.class = $3               -- Hang ghe
    AND fs.available_seats >= $4   -- Du ghế
    AND DATE(f.departure_time) = $5 -- Ngay khoi hanh
  ORDER BY f.departure_time ASC, fs.base_price ASC
`;

// Tim chuyen bay buoc 1 (di tu departure -> intermediate)
const FIND_FIRST_LEG = `
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
    al.logo_url AS airline_logo,
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
    AND fs.class = $2
    AND fs.available_seats >= $3
    AND DATE(f.departure_time) = $4
    AND arr.code != $1  -- Khong dung lai o san bay khoi hanh
  ORDER BY f.arrival_time ASC
`;

// Tim chuyen bay buoc 2 (di tu intermediate -> arrival)
const FIND_SECOND_LEG = `
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
    al.logo_url AS airline_logo,
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
    AND dep.code = $1              -- Di tu intermediate
    AND arr.code = $2              -- Den dich vu
    AND fs.class = $3
    AND fs.available_seats >= $4
    AND DATE(f.departure_time) = $5
  ORDER BY f.departure_time ASC
`;

// Tim chuyen bay buoc 1 (cho 2-stop)
const FIND_FIRST_LEG_2STOP = `
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
    al.logo_url AS airline_logo,
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
    AND fs.class = $2
    AND fs.available_seats >= $3
    AND DATE(f.departure_time) = $4
    AND arr.code != $1
  ORDER BY f.arrival_time ASC
`;

// Tim chuyen bay buoc 2 (di qua 1 diem trung gian)
const FIND_MID_LEG = `
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
    al.logo_url AS airline_logo,
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
    AND fs.class = $2
    AND fs.available_seats >= $3
    AND DATE(f.departure_time) = $4
    AND arr.code != $1
    AND arr.code != $5  -- Khong den thang diem cuoi
  ORDER BY f.arrival_time ASC
`;

// Tim chuyen bay buoc cuoi (den noi)
const FIND_LAST_LEG = `
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
    al.logo_url AS airline_logo,
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
    AND fs.available_seats >= $4
    AND DATE(f.departure_time) = $5
  ORDER BY f.departure_time ASC
`;

module.exports = {
  FIND_DIRECT_FLIGHTS,
  FIND_FIRST_LEG,
  FIND_SECOND_LEG,
  FIND_FIRST_LEG_2STOP,
  FIND_MID_LEG,
  FIND_LAST_LEG,
  MIN_LAYOVER_MINUTES,
  MAX_LAYOVER_HOURS,
};
