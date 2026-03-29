const pool = require("../config/db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validateSearchParams = ({
  departure_code, arrival_code, departure_date,
  adults, children, infants, seat_class, return_date,
}) => {
  if (!departure_code || !arrival_code || !departure_date || !seat_class) {
    throw new Error("departure_code, arrival_code, departure_date và seat_class là bắt buộc");
  }
  if (departure_code.toUpperCase() === arrival_code.toUpperCase()) {
    throw new Error("Điểm đi và điểm đến không được trùng nhau");
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(departure_date)) {
    throw new Error("departure_date phải có định dạng YYYY-MM-DD");
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const depDate = new Date(departure_date);
  if (depDate < today) {
    throw new Error("Ngày đi không được là ngày trong quá khứ");
  }

  if (return_date) {
    if (!dateRegex.test(return_date)) {
      throw new Error("return_date phải có định dạng YYYY-MM-DD");
    }
    if (new Date(return_date) <= depDate) {
      throw new Error("Ngày về phải sau ngày đi");
    }
  }

  const validClasses = ["economy", "business", "first"];
  if (!validClasses.includes(seat_class.toLowerCase())) {
    throw new Error("seat_class phải là một trong: economy, business, first");
  }

  const a = parseInt(adults) || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants) || 0;

  if (a < 1)           throw new Error("Phải có ít nhất 1 người lớn");
  if (c < 0 || i < 0) throw new Error("Số trẻ em / em bé không hợp lệ");
  if (a + c > 9)       throw new Error("Tổng số hành khách (người lớn + trẻ em) không được quá 9");
  if (i > a)           throw new Error("Số em bé không được nhiều hơn số người lớn");
};

const formatDuration = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

/**
 * Tính tổng tiền vé theo loại hành khách
 * - Adults:   100%
 * - Children: 75%
 * - Infants:  10% (không chiếm ghế)
 */
const calcTotalPrice = (basePrice, adults, children, infants) => {
  const adultTotal  = basePrice * adults;
  const childTotal  = basePrice * 0.75 * children;
  const infantTotal = basePrice * 0.10 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
};

/**
 * Tạo danh sách lựa chọn hành lý thêm đã tính sẵn giá (per person)
 * price_per_person = số_kg × extra_baggage_price
 */
const buildBaggageOptions = (extraBaggagePrice) => {
  const pricePerKg = parseFloat(extraBaggagePrice) || 0;
  return [
    { kg: 0,  label: "No extra", price_per_person: 0 },
    { kg: 5,  label: "+5 kg",    price_per_person: 5  * pricePerKg },
    { kg: 10, label: "+10 kg",   price_per_person: 10 * pricePerKg },
    { kg: 20, label: "+20 kg",   price_per_person: 20 * pricePerKg },
  ];
};

const formatFlights = (rows, adults, children, infants) =>
  rows.map((r) => {
    const base       = parseFloat(r.base_price) || 0;
    const extraPrice = parseFloat(r.extra_baggage_price) || 0;

    return {
      flight_id:     r.flight_id,
      flight_number: r.flight_number,
      status:        r.status,

      airline: {
        id:       r.airline_id,
        code:     r.airline_code,
        name:     r.airline_name,
        logo_url: r.airline_logo,
      },

      departure: {
        airport_id:   r.departure_airport_id,
        code:         r.departure_code,
        airport_name: r.departure_airport_name,
        city:         r.departure_city,
        time:         r.departure_time,
      },

      arrival: {
        airport_id:   r.arrival_airport_id,
        code:         r.arrival_code,
        airport_name: r.arrival_airport_name,
        city:         r.arrival_city,
        time:         r.arrival_time,
      },

      duration_minutes: r.duration_minutes,
      duration_label:   formatDuration(r.duration_minutes),

      seat: {
        class:           r.seat_class,
        available_seats: r.available_seats,
        total_seats:     r.total_seats,

        // Giá gốc 1 người lớn — dùng để hiển thị "/Customer"
        base_price: base,

        // Hành lý
        baggage_included_kg: r.baggage_included_kg,
        carry_on_kg:         r.carry_on_kg,

        // Giá mỗi kg thêm (raw)
        extra_baggage_price: extraPrice,

        // Lựa chọn hành lý thêm — giá đã tính sẵn cho từng mức (per person)
        extra_baggage_options: buildBaggageOptions(extraPrice),

        // Breakdown giá từng loại hành khách (per person)
        price_breakdown: {
          adult_price:  base,
          child_price:  Math.round(base * 0.75),
          infant_price: Math.round(base * 0.10),
        },

        // Tổng tiền vé toàn đoàn (chưa tính hành lý thêm)
        total_price: calcTotalPrice(base, adults, children, infants),
      },
    };
  });

const queryFlights = async ({
  departure_code, arrival_code, departure_date,
  adults, children, infants,
  seat_class, sort_by = "price_asc",
  min_price, max_price, airline_code,
  departure_city, arrival_city,
}) => {
  const a   = parseInt(adults)   || 1;
  const c   = parseInt(children) || 0;
  const cls = seat_class.toLowerCase();

  const seatsNeeded = a + c; // infants không chiếm ghế

  const sortMap = {
    price_asc:     "fs.base_price ASC",
    price_desc:    "fs.base_price DESC",
    duration_asc:  "f.duration_minutes ASC",
    departure_asc: "f.departure_time ASC",
  };
  const orderBy = sortMap[sort_by] || sortMap["price_asc"];

  const conditions = [];
  const values     = [];
  let   idx        = 1;

  conditions.push(`dep_ap.code = $${idx++}`);            values.push(departure_code.toUpperCase());
  conditions.push(`arr_ap.code = $${idx++}`);            values.push(arrival_code.toUpperCase());
  conditions.push(`DATE(f.departure_time) = $${idx++}`); values.push(departure_date);
  conditions.push(`fs.class = $${idx++}`);               values.push(cls);
  conditions.push(`fs.available_seats >= $${idx++}`);    values.push(seatsNeeded);
  conditions.push(`f.status = 'scheduled'`);
  conditions.push(`f.is_active = TRUE`);

  if (min_price !== undefined && min_price !== "") {
    conditions.push(`fs.base_price >= $${idx++}`);
    values.push(parseFloat(min_price));
  }
  if (max_price !== undefined && max_price !== "") {
    conditions.push(`fs.base_price <= $${idx++}`);
    values.push(parseFloat(max_price));
  }
  if (airline_code) {
    conditions.push(`al.code = $${idx++}`);
    values.push(airline_code.toUpperCase());
  }
  if (departure_city) {
    conditions.push(`LOWER(dep_ap.city) LIKE LOWER($${idx++})`);
    values.push(`%${departure_city}%`);
  }
  if (arrival_city) {
    conditions.push(`LOWER(arr_ap.city) LIKE LOWER($${idx++})`);
    values.push(`%${arrival_city}%`);
  }

  const sql = `
    SELECT
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
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}
  `;

  const result = await pool.query(sql, values);
  return result.rows;
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * GET /api/flights/search
 */
const searchFlights = async (params) => {
  const {
    departure_code, arrival_code, departure_date,
    adults = 1, children = 0, infants = 0,
    seat_class, return_date, sort_by,
    min_price, max_price, airline_code,
    departure_city, arrival_city,
  } = params;

  validateSearchParams({
    departure_code, arrival_code, departure_date,
    adults, children, infants, seat_class, return_date,
  });

  const a = parseInt(adults);
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;

  const baseParams = {
    departure_code, arrival_code, departure_date,
    adults: a, children: c, infants: i,
    seat_class, sort_by, min_price, max_price,
    airline_code, departure_city, arrival_city,
  };

  // Chuyến đi
  const outboundRows    = await queryFlights(baseParams);
  const outboundFlights = formatFlights(outboundRows, a, c, i);

  // Chuyến về (khứ hồi)
  let returnFlights = null;
  if (return_date) {
    const returnRows = await queryFlights({
      ...baseParams,
      departure_code: arrival_code,
      arrival_code:   departure_code,
      departure_date: return_date,
    });
    returnFlights = formatFlights(returnRows, a, c, i);
  }

  return {
    trip_type:        return_date ? "round_trip" : "one_way",
    passengers:       { adults: a, children: c, infants: i, total: a + c + i },
    seat_class,
    outbound_flights: outboundFlights,
    return_flights:   returnFlights,
    total_outbound:   outboundFlights.length,
    total_return:     returnFlights ? returnFlights.length : null,
  };
};

/**
 * GET /api/flights/airports
 */
const getAirports = async () => {
  const result = await pool.query(
    `SELECT id, code, name, city, country
     FROM airports WHERE is_active = TRUE ORDER BY city ASC`
  );
  return result.rows;
};

/**
 * GET /api/flights/airlines
 */
const getAirlines = async () => {
  const result = await pool.query(
    `SELECT id, code, name, logo_url
     FROM airlines WHERE is_active = TRUE ORDER BY name ASC`
  );
  return result.rows;
};

/**
 * GET /api/flights/:id?adults=2&children=1&infants=0
 * Truyền số hành khách để tính đúng total_price
 */
const getFlightById = async (flightId, { adults = 1, children = 0, infants = 0 } = {}) => {
  const a = parseInt(adults)   || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;

  const result = await pool.query(
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
              arr.code, arr.name, arr.city`,
    [flightId]
  );

  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const r = result.rows[0];

  const seatsWithPrice = (r.seats || []).map((s) => {
    const base       = parseFloat(s.base_price) || 0;
    const extraPrice = parseFloat(s.extra_baggage_price) || 0;
    return {
      ...s,
      base_price:          base,
      extra_baggage_price: extraPrice,

      // Lựa chọn hành lý thêm đã tính sẵn (per person)
      extra_baggage_options: buildBaggageOptions(extraPrice),

      // Breakdown giá từng loại hành khách (per person)
      price_breakdown: {
        adult_price:  base,
        child_price:  Math.round(base * 0.75),
        infant_price: Math.round(base * 0.10),
      },

      // Tổng tiền vé cho số hành khách đã truyền vào
      total_price: calcTotalPrice(base, a, c, i),
    };
  });

  return {
    flight_id:        r.id,
    flight_number:    r.flight_number,
    status:           r.status,
    duration_minutes: r.duration_minutes,
    duration_label:   formatDuration(r.duration_minutes),
    passengers:       { adults: a, children: c, infants: i, total: a + c + i },
    airline: {
      code:     r.airline_code,
      name:     r.airline_name,
      logo_url: r.logo_url,
    },
    departure: {
      code:         r.departure_code,
      airport_name: r.departure_name,
      city:         r.departure_city,
      time:         r.departure_time,
    },
    arrival: {
      code:         r.arrival_code,
      airport_name: r.arrival_name,
      city:         r.arrival_city,
      time:         r.arrival_time,
    },
    seats: seatsWithPrice,
  };
};

module.exports = { searchFlights, getAirports, getAirlines, getFlightById };