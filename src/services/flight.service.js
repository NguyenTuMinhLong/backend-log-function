// src/services/flight.service.js
const pool = require('../config/db');
const QF = require('../queries/flight.queries');

const recommendFlights = async ({ userId, fromAirport, toAirport, limit = 15 }) => {
  const query = `
    SELECT
      f.id              AS flight_id,
      f.flight_number,
      f.departure_time,
      f.arrival_time,
      f.duration_minutes,
      f.status,
      al.id             AS airline_id,
      al.code           AS airline_code,
      al.name           AS airline_name,
      al.logo_url       AS airline_logo,
      al.logo_dark      AS airline_logo_dark,
      al.logo_light     AS airline_logo_light,
      dep.id            AS departure_airport_id,
      dep.code          AS departure_code,
      dep.city          AS departure_city,
      dep.name          AS departure_airport_name,
      arr.id            AS arrival_airport_id,
      arr.code          AS arrival_code,
      arr.city          AS arrival_city,
      arr.name          AS arrival_airport_name,
      fs.class          AS seat_class,
      fs.total_seats,
      fs.available_seats,
      fs.base_price,
      fs.baggage_included_kg,
      fs.carry_on_kg,
      fs.extra_baggage_price
    FROM flights f
    JOIN airlines     al  ON al.id  = f.airline_id
    JOIN airports     dep ON dep.id = f.departure_airport_id
    JOIN airports     arr ON arr.id = f.arrival_airport_id
    LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = 'economy'
    WHERE f.status = 'scheduled'
      AND f.is_active = true
      AND f.departure_time > NOW()
    ORDER BY f.departure_time ASC
    LIMIT $1`;

  const { rows } = await pool.query(query, [limit]);
  return formatFlights(rows, 1, 0, 0);
};

const formatDuration = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

/**
 * Tính tổng tiền vé theo loại hành khách
 */
const calcTotalPrice = (basePrice, adults, children, infants) => {
  const adultTotal  = basePrice * adults;
  const childTotal  = basePrice * 0.75 * children;
  const infantTotal = basePrice * 0.10 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
};

/**
 * Tạo danh sách lựa chọn hành lý thêm đã tính sẵn giá (per person)
 */
const buildBaggageOptions = (extraBaggagePrice) => {
  const pricePerKg = parseFloat(extraBaggagePrice) || 0;
  return [
    { kg: 0,  label: "No extra", price_per_person: 0 },
    { kg: 5,  label: "+5 kg",    price_per_person: 5  * pricePerKg },
    { kg: 10, label: "+10 kg",   price_per_person: 10 * pricePerKg },
    { kg: 15, label: "+15 kg",   price_per_person: 15 * pricePerKg },
    { kg: 20, label: "+20 kg",   price_per_person: 20 * pricePerKg },
  ];
};

// ── Dynamic pricing helpers (applied at search time) ──────────────────────────

// Weekend premium: Fri/Sat/Sun cost more
const { applyDynamicPricing } = require('../utils/pricing');

const formatFlights = (rows, adults, children, infants) =>
  rows.map((r) => {
    const base        = parseFloat(r.base_price) || 0;
    const extraPrice  = parseFloat(r.extra_baggage_price) || 0;
    const price       = applyDynamicPricing(base, r.available_seats, r.total_seats, r.departure_time);

    return {
      flight_id:     r.flight_id,
      flight_number: r.flight_number,
      status:        r.status,
      airline: {
        id: r.airline_id, code: r.airline_code, name: r.airline_name,
        logo_url: r.airline_logo, logo_dark: r.airline_logo_dark, logo_light: r.airline_logo_light,
      },
      departure: {
        airport_id: r.departure_airport_id, code: r.departure_code,
        airport_name: r.departure_airport_name, city: r.departure_city, time: r.departure_time,
      },
      arrival: {
        airport_id: r.arrival_airport_id, code: r.arrival_code,
        airport_name: r.arrival_airport_name, city: r.arrival_city, time: r.arrival_time,
      },
      duration_minutes: r.duration_minutes,
      duration_label:   formatDuration(r.duration_minutes),
      seat: {
        class:                 r.seat_class,
        available_seats:       r.available_seats,
        total_seats:           r.total_seats,
        base_price:            price,
        baggage_included_kg:   r.baggage_included_kg,
        carry_on_kg:           r.carry_on_kg,
        extra_baggage_price:   extraPrice,
        extra_baggage_options: buildBaggageOptions(extraPrice),
        price_breakdown: {
          adult_price:  price,
          child_price:  Math.round(price * 0.75),
          infant_price: Math.round(price * 0.10),
        },
        total_price: calcTotalPrice(price, adults, children, infants),
      },
    };
  });

// ─── Validation ────────────────────────────────────────────────────────────────

const validateSearchParams = ({ departure_code, arrival_code, departure_date, adults, children, infants, seat_class }) => {
  if (!departure_code) throw new Error("Mã sân bay đi là bắt buộc");
  if (!arrival_code) throw new Error("Mã sân bay đến là bắt buộc");
  if (!departure_date) throw new Error("Ngày khởi hành là bắt buộc");
  
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(departure_date)) throw new Error("Ngày khởi hành không hợp lệ (định dạng: YYYY-MM-DD)");
  
  const a = parseInt(adults) || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants) || 0;
  if (a < 1) throw new Error("Phải có ít nhất 1 người lớn");
  if (i > a) throw new Error("Số em bé không được nhiều hơn số người lớn");
  
  if (seat_class && !['economy', 'business', 'first'].includes(seat_class.toLowerCase())) {
    throw new Error("seat_class phải là economy, business hoặc first");
  }
};

const queryFlights = async ({
  departure_code, arrival_code, departure_date,
  adults, children, infants,
  seat_class, sort_by = "price_asc",
  min_price, max_price, airline_code,
  departure_city, arrival_city,
}) => {
  const a   = parseInt(adults) || 1;
  const c   = parseInt(children) || 0;
  const cls = seat_class.toLowerCase();
  const seatsNeeded = a + c;

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

  conditions.push(`dep.code = $${idx++}`);            values.push(departure_code.toUpperCase());
  conditions.push(`arr.code = $${idx++}`);            values.push(arrival_code.toUpperCase());
  conditions.push(`DATE(f.departure_time) = $${idx++}`); values.push(departure_date);
  conditions.push(`fs.class = $${idx++}`);               values.push(cls);
  conditions.push(`fs.available_seats >= $${idx++}`);    values.push(seatsNeeded);
  conditions.push(`f.status = 'scheduled'`);
  conditions.push(`f.is_active = TRUE`);

  if (min_price !== undefined && min_price !== "") { conditions.push(`fs.base_price >= $${idx++}`); values.push(parseFloat(min_price)); }
  if (max_price !== undefined && max_price !== "") { conditions.push(`fs.base_price <= $${idx++}`); values.push(parseFloat(max_price)); }
  if (airline_code)   { conditions.push(`al.code = $${idx++}`);                         values.push(airline_code.toUpperCase()); }
  if (departure_city) { conditions.push(`LOWER(dep.city) LIKE LOWER($${idx++})`);    values.push(`%${departure_city}%`); }
  if (arrival_city)   { conditions.push(`LOWER(arr.city) LIKE LOWER($${idx++})`);    values.push(`%${arrival_city}%`); }

  const result = await pool.query(
    QF.SEARCH_FLIGHTS(conditions.join(" AND "), orderBy),
    values
  );
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

  validateSearchParams({ departure_code, arrival_code, departure_date, adults, children, infants, seat_class, return_date });

  const a = parseInt(adults);
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;

  const baseParams = {
    departure_code, arrival_code, departure_date,
    adults: a, children: c, infants: i,
    seat_class, sort_by, min_price, max_price,
    airline_code, departure_city, arrival_city,
  };

  const outboundRows    = await queryFlights(baseParams);
  const outboundFlights = formatFlights(outboundRows, a, c, i);

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
    outbound_flights: outboundFlights,
    return_flights: returnFlights,
    total_outbound: outboundFlights.length,
    total_return: returnFlights ? returnFlights.length : 0,
  };
};

/**
 * Lấy chuyến bay phổ biến nhất
 */
const getPopularFlights = async (fromAirport, toAirport, limit) => {
  const isGeneralMode = !fromAirport || !toAirport;

  let query, params;

  if (isGeneralMode) {
    query = queries.GET_POPULAR_FLIGHTS_GENERAL;
    params = [limit];
  } else {
    query = queries.GET_POPULAR_FLIGHTS_ROUTE;
    params = [fromAirport, toAirport, limit];
  }

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Tạo lưới ghế ảo dựa vào tổng số ghế của class
 * Layout chuẩn: hàng × cột. Mỗi hàng có đến 6 ghế (A-F) với lối đi ở giữa.
 *   first    → 4 ghế/hàng: A B _ C D  (2-2)
 *   business → 4 ghế/hàng: A B _ C D  (2-2)
 *   economy  → 6 ghế/hàng: A B C _ D E F  (3-3)
 *
 * @param {string}  seatClass   - "first" | "business" | "economy"
 * @param {number}  totalSeats  - Tổng số ghế của class này trên chuyến bay
 * @param {number}  startRow    - Số hàng bắt đầu (để ghép nhiều class)
 * @returns {{ rows: object[], columns: string[], seatsPerRow: number, lastRow: number }}
 */
const buildSeatLayout = (seatClass, totalSeats, startRow = 1) => {
  const layoutMap = {
    first:    { columns: ["A", "B", "C", "D"], seatsPerRow: 4 },
    business: { columns: ["A", "B", "C", "D"], seatsPerRow: 4 },
    economy:  { columns: ["A", "B", "C", "D", "E", "F"], seatsPerRow: 6 },
  };
  const { columns, seatsPerRow } = layoutMap[seatClass] || layoutMap.economy;

  const numRows = Math.ceil(totalSeats / seatsPerRow);
  const rows    = [];
  let   seatIdx = 0;

  for (let r = 0; r < numRows; r++) {
    const rowNum  = startRow + r;
    const seats   = [];
    for (let c = 0; c < columns.length; c++) {
      if (seatIdx >= totalSeats) break;
      seats.push({ seat_number: `${rowNum}${columns[c]}`, column: columns[c] });
      seatIdx++;
    }
    rows.push({ row: rowNum, seats });
  }

  return { rows, columns, seatsPerRow, lastRow: startRow + numRows - 1 };
};

/**
 * GET /api/flights/:id/seat-map
 * SB-03: Xem sơ đồ ghế ngồi – trạng thái từng ghế (available / occupied)
 */
const getSeatMap = async (flightId, params = {}) => {
  const { seat_class = null } = params;

  if (!flightId) throw new Error("flight_id là bắt buộc");

  const cls = seat_class ? seat_class.toLowerCase() : null;
  const validClasses = ["economy", "business", "first"];
  if (cls && !validClasses.includes(cls)) {
    throw new Error("seat_class phải là một trong: economy, business, first");
  }

  // ── 1. Thông tin ghế theo class ────────────────────────────────────────────
  const classInfoResult = await pool.query(
    QF.SELECT_FLIGHT_SEAT_CLASS_INFO, [flightId, cls]
  );
  if (classInfoResult.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const flightMeta = classInfoResult.rows[0];

  // ── 2. Ghế đã bị chiếm ────────────────────────────────────────────────────
  const occupiedResult = await pool.query(QF.SELECT_OCCUPIED_SEATS, [flightId, cls]);
  const occupiedMap    = {};
  occupiedResult.rows.forEach((r) => {
    occupiedMap[r.seat_number] = r.status; // "occupied" | "available" (custom override)
  });

  // ── 3. Tạo sơ đồ ghế cho từng class ──────────────────────────────────────
  let currentRow = 1;
  const classMaps = classInfoResult.rows.map((ci) => {
    const layout    = buildSeatLayout(ci.class, ci.total_seats, currentRow);
    currentRow      = layout.lastRow + 2; // Khoảng cách 1 hàng trống giữa các class

    const seatRows = layout.rows.map((row) => ({
      row:    row.row,
      seats:  row.seats.map((s) => ({
        seat_number: s.seat_number,
        column:      s.column,
        // Ghế có trong flight_seat_assignments với status="occupied" → taken
        status:      occupiedMap[s.seat_number] === "occupied" ? "occupied" : "available",
      })),
    }));

    return {
      class:           ci.class,
      total_seats:     ci.total_seats,
      available_seats: ci.available_seats,
      base_price:      parseFloat(ci.base_price) || 0,
      columns:         layout.columns,
      seats_per_row:   layout.seatsPerRow,
      rows:            seatRows,
    };
  });

  return {
    flight_id:      parseInt(flightId),
    flight_number:  flightMeta.flight_number,
    flight_status:  flightMeta.flight_status,
    departure_time: flightMeta.departure_time,
    airline:        { code: flightMeta.airline_code, name: flightMeta.airline_name },
    route:          { from: flightMeta.departure_code, to: flightMeta.arrival_code },
    seat_map:       classMaps,
  };
};


/**
 * Tính vị trí máy bay hiện tại theo thời gian thực
 * Dùng cho Flight Tracker
 * Logic: lerp(dep_coords, arr_coords, progress)
 */
const getFlightPosition = async (flightId) => {
  // 1. Lấy thông tin chuyến bay + tọa độ 2 sân bay
  const result = await pool.query(QF.SELECT_FLIGHT_POSITION, [flightId]);

  if (!result.rows.length) {
    throw new Error("Không tìm thấy chuyến bay");
  }

  const f = result.rows[0];

  // 2. Tính thời gian
  const now        = Date.now();
  const depTime    = new Date(f.departure_time).getTime();
  const durationMs = f.duration_minutes * 60 * 1000;
  const arrTime    = depTime + durationMs;

  // 3. Tính progress (0.0 → 1.0)
  let progress = 0;
  if (now >= depTime) {
    progress = Math.min(1, (now - depTime) / durationMs);
  }

  // 4. Nội suy tuyến tính vị trí (lerp)
  const lat = parseFloat(f.dep_lat) +
    (parseFloat(f.arr_lat) - parseFloat(f.dep_lat)) * progress;
  const lng = parseFloat(f.dep_lng) +
    (parseFloat(f.arr_lng) - parseFloat(f.dep_lng)) * progress;

  // 5. Tính góc xoay icon máy bay
  const dLat   = parseFloat(f.arr_lat) - parseFloat(f.dep_lat);
  const dLng   = parseFloat(f.arr_lng) - parseFloat(f.dep_lng);
  const heading = Math.atan2(dLng, dLat) * (180 / Math.PI);

  // 6. Xác định trạng thái
  let trackStatus = "scheduled";
  if (now >= depTime && now < arrTime) trackStatus = "airborne";
  if (now >= arrTime)                  trackStatus = "landed";

  return {
    flightId:      f.id,
    flightNumber:  f.flight_number,
    status:        trackStatus,
    progress:      parseFloat(progress.toFixed(4)),
    timeRemaining: Math.max(0, arrTime - now), // milliseconds
    position: {
      lat:     parseFloat(lat.toFixed(6)),
      lng:     parseFloat(lng.toFixed(6)),
      heading: parseFloat(heading.toFixed(2)),
    },
    departure: {
      code: f.dep_code,
      city: f.dep_city,
      lat:  parseFloat(f.dep_lat),
      lng:  parseFloat(f.dep_lng),
      time: f.departure_time,
    },
    arrival: {
      code: f.arr_code,
      city: f.arr_city,
      lat:  parseFloat(f.arr_lat),
      lng:  parseFloat(f.arr_lng),
      time: new Date(arrTime).toISOString(),
    },
  };
};

// ─── getAirports ───────────────────────────────────────────────────────────────

const getAirports = async () => {
  const { rows } = await pool.query(QF.SELECT_ALL_AIRPORTS);
  return rows;
};

// ─── getAirlines ──────────────────────────────────────────────────────────────

const getAirlines = async () => {
  const { rows } = await pool.query(QF.SELECT_ALL_AIRLINES);
  return rows;
};

// ─── getFlightById ─────────────────────────────────────────────────────────────

const getFlightById = async (flightId, params = {}) => {
  const { adults = 1, children = 0, infants = 0 } = params;
  const a = parseInt(adults);
  const c = parseInt(children);
  const i = parseInt(infants);

  const result = await pool.query(QF.SELECT_FLIGHT_BY_ID, [flightId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const flight = result.rows[0];
  const seatsResult = await pool.query(`
    SELECT * FROM flight_seats WHERE flight_id = $1 ORDER BY base_price
  `, [flightId]);

  return {
    ...flight,
    seats: seatsResult.rows.map(s => ({
      ...s,
      total_price: calcTotalPrice(parseFloat(s.base_price), a, c, i),
    })),
  };
};

// ─── getAlternativeFlights ────────────────────────────────────────────────────

const getAlternativeFlights = async (flightId, params = {}) => {
  const { seat_class = 'economy', adults = 1, children = 0, infants = 0 } = params;
  const a = parseInt(adults);
  const c = parseInt(children);
  const i = parseInt(infants);

  const original = await pool.query(QF.SELECT_FLIGHT_BY_ID, [flightId]);
  if (original.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const orig = original.rows[0];
  const departureDate = new Date(orig.departure_time).toISOString().split('T')[0];
  const seatsNeeded = a + c;

  const result = await pool.query(QF.SEARCH_ALTERNATIVE_FLIGHTS, [
    flightId, orig.departure_code, orig.arrival_code, seat_class, seatsNeeded, departureDate
  ]);

  return formatFlights(result.rows, a, c, i);
};

// ─── getPriceCalendar ──────────────────────────────────────────────────────────

const getPriceCalendar = async (params = {}) => {
  const { from, to, month, seat_class = 'economy', adults = 1 } = params;
  if (!from || !to || !month) throw new Error("Thiếu tham số bắt buộc: from, to, month");

  const startDate = month + '-01';
  const endDate = new Date(month + '-01');
  endDate.setMonth(endDate.getMonth() + 1);
  const endDateStr = endDate.toISOString().split('T')[0];

  const result = await pool.query(QF.GET_MIN_PRICES_CALENDAR, [
    from.toUpperCase(), to.toUpperCase(), seat_class, startDate, endDateStr
  ]);

  return result.rows;
};

module.exports = { 
  recommendFlights,
  searchFlights,
  getAirports,
  getAirlines,
  getFlightById,
  getAlternativeFlights,
  getPriceCalendar,
  getSeatMap,
  getFlightPosition,
};