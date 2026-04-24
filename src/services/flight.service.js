const pool = require("../config/db");
const QF   = require("../queries/flight.queries");
const QAL  = require("../queries/airline.queries");
const QAP  = require("../queries/airport.queries");

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
  if (!dateRegex.test(departure_date)) throw new Error("departure_date phải có định dạng YYYY-MM-DD");

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (new Date(departure_date) < today) throw new Error("Ngày đi không được là ngày trong quá khứ");

  if (return_date) {
    if (!dateRegex.test(return_date)) throw new Error("return_date phải có định dạng YYYY-MM-DD");
    if (new Date(return_date) <= new Date(departure_date)) throw new Error("Ngày về phải sau ngày đi");
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

const formatFlights = (rows, adults, children, infants) =>
  rows.map((r) => {
    const base       = parseFloat(r.base_price) || 0;
    const extraPrice = parseFloat(r.extra_baggage_price) || 0;

    return {
      flight_id:     r.flight_id,
      flight_number: r.flight_number,
      status:        r.status,
      airline: {
        id: r.airline_id, code: r.airline_code, name: r.airline_name, logo_url: r.airline_logo,
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
        base_price:            base,
        baggage_included_kg:   r.baggage_included_kg,
        carry_on_kg:           r.carry_on_kg,
        extra_baggage_price:   extraPrice,
        extra_baggage_options: buildBaggageOptions(extraPrice),
        price_breakdown: {
          adult_price:  base,
          child_price:  Math.round(base * 0.75),
          infant_price: Math.round(base * 0.10),
        },
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

  conditions.push(`dep_ap.code = $${idx++}`);            values.push(departure_code.toUpperCase());
  conditions.push(`arr_ap.code = $${idx++}`);            values.push(arrival_code.toUpperCase());
  conditions.push(`DATE(f.departure_time) = $${idx++}`); values.push(departure_date);
  conditions.push(`fs.class = $${idx++}`);               values.push(cls);
  conditions.push(`fs.available_seats >= $${idx++}`);    values.push(seatsNeeded);
  conditions.push(`f.status = 'scheduled'`);
  conditions.push(`f.is_active = TRUE`);

  if (min_price !== undefined && min_price !== "") { conditions.push(`fs.base_price >= $${idx++}`); values.push(parseFloat(min_price)); }
  if (max_price !== undefined && max_price !== "") { conditions.push(`fs.base_price <= $${idx++}`); values.push(parseFloat(max_price)); }
  if (airline_code)   { conditions.push(`al.code = $${idx++}`);                         values.push(airline_code.toUpperCase()); }
  if (departure_city) { conditions.push(`LOWER(dep_ap.city) LIKE LOWER($${idx++})`);    values.push(`%${departure_city}%`); }
  if (arrival_city)   { conditions.push(`LOWER(arr_ap.city) LIKE LOWER($${idx++})`);    values.push(`%${arrival_city}%`); }

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
  const result = await pool.query(QAP.SELECT_ACTIVE_AIRPORTS);
  return result.rows;
};

/**
 * GET /api/flights/airlines
 */
const getAirlines = async () => {
  const result = await pool.query(QAL.SELECT_ACTIVE_AIRLINES);
  return result.rows;
};

/**
 * GET /api/flights/:id
 */
const getFlightById = async (flightId, { adults = 1, children = 0, infants = 0 } = {}) => {
  const a = parseInt(adults)   || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;

  const result = await pool.query(QF.SELECT_FLIGHT_BY_ID, [flightId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const r = result.rows[0];

  const seatsWithPrice = (r.seats || []).map((s) => {
    const base       = parseFloat(s.base_price) || 0;
    const extraPrice = parseFloat(s.extra_baggage_price) || 0;
    return {
      ...s,
      base_price:            base,
      extra_baggage_price:   extraPrice,
      extra_baggage_options: buildBaggageOptions(extraPrice),
      price_breakdown: {
        adult_price:  base,
        child_price:  Math.round(base * 0.75),
        infant_price: Math.round(base * 0.10),
      },
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
    airline:   { code: r.airline_code,    name: r.airline_name,    logo_url: r.logo_url },
    departure: { code: r.departure_code,  airport_name: r.departure_name, city: r.departure_city, time: r.departure_time },
    arrival:   { code: r.arrival_code,    airport_name: r.arrival_name,   city: r.arrival_city,   time: r.arrival_time },
    seats: seatsWithPrice,
  };
};

/**
 * GET /api/flights/alternatives
 * SB-01: Gợi ý chuyến bay thay thế khi chuyến được chọn hết vé / không phù hợp
 */
const getAlternativeFlights = async (flightId, params = {}) => {
  const { seat_class = "economy", adults = 1, children = 0, infants = 0 } = params;

  const a   = parseInt(adults)   || 1;
  const c   = parseInt(children) || 0;
  const i   = parseInt(infants)  || 0;
  const cls = seat_class.toLowerCase();

  const validClasses = ["economy", "business", "first"];
  if (!validClasses.includes(cls)) throw new Error("seat_class phải là một trong: economy, business, first");
  if (!flightId)                   throw new Error("flight_id là bắt buộc");

  const seatsNeeded = a + c;

  // ── 1. Lấy thông tin chuyến bay gốc ────────────────────────────────────────
  const origResult = await pool.query(QF.SELECT_ORIGINAL_FLIGHT, [flightId, cls]);
  if (origResult.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const orig    = origResult.rows[0];
  const depDate = new Date(orig.departure_time).toISOString().slice(0, 10);
  const origBase = parseFloat(orig.base_price) || 0;

  const formatOrigFlight = (r) => ({
    flight_id:        r.flight_id,
    flight_number:    r.flight_number,
    status:           r.status,
    duration_minutes: r.duration_minutes,
    duration_label:   formatDuration(r.duration_minutes),
    airline: {
      id: r.airline_id, code: r.airline_code, name: r.airline_name, logo_url: r.airline_logo,
    },
    departure: {
      airport_id: r.departure_airport_id, code: r.departure_code,
      airport_name: r.departure_airport_name, city: r.departure_city, time: r.departure_time,
    },
    arrival: {
      airport_id: r.arrival_airport_id, code: r.arrival_code,
      airport_name: r.arrival_airport_name, city: r.arrival_city, time: r.arrival_time,
    },
    seat: {
      class:               r.seat_class,
      available_seats:     r.available_seats,
      total_seats:         r.total_seats,
      base_price:          origBase,
      baggage_included_kg: r.baggage_included_kg,
      carry_on_kg:         r.carry_on_kg,
      extra_baggage_price: parseFloat(r.extra_baggage_price) || 0,
      total_price:         calcTotalPrice(origBase, a, c, i),
    },
  });

  // ── 2. Chuyến cùng tuyến cùng ngày còn ghế (hãng khác hoặc giờ khác) ──────
  const sameRouteResult = await pool.query(QF.SELECT_SAME_ROUTE_ALTERNATIVES, [
    flightId,
    orig.departure_airport_id,
    orig.arrival_airport_id,
    depDate,
    cls,
    seatsNeeded,
  ]);
  const sameRouteFlights = formatFlights(sameRouteResult.rows, a, c, i);

  // ── 3. Chuyến có quá cảnh giá rẻ hơn ───────────────────────────────────────
  // Tìm các cặp chuyến nối chuyến có tổng giá thấp hơn 110% giá chuyến gốc
  const priceLimit = origBase > 0 ? origBase * 1.1 : 999999999;

  const layoverResult = await pool.query(QF.SELECT_LAYOVER_FLIGHTS, [
    orig.departure_airport_id,
    orig.arrival_airport_id,
    depDate,
    cls,
    seatsNeeded,
    priceLimit,
  ]);

  const formatLayoverFlight = (r) => {
    const leg1Base = parseFloat(r.leg1_base_price) || 0;
    const leg2Base = parseFloat(r.leg2_base_price) || 0;
    const combinedBase = leg1Base + leg2Base;
    const layoverMin   = Math.round(parseFloat(r.layover_minutes) || 0);

    return {
      type:                  "layover",
      combined_base_price:   combinedBase,
      combined_total_price:  calcTotalPrice(combinedBase, a, c, i),
      layover_minutes:       layoverMin,
      layover_label:         formatDuration(layoverMin),
      hub: {
        airport_id:   r.hub_airport_id,
        code:         r.hub_code,
        airport_name: r.hub_name,
        city:         r.hub_city,
      },
      leg1: {
        flight_id:        r.leg1_flight_id,
        flight_number:    r.leg1_flight_number,
        departure_time:   r.leg1_departure_time,
        arrival_time:     r.leg1_arrival_time,
        duration_minutes: r.leg1_duration_minutes,
        duration_label:   formatDuration(r.leg1_duration_minutes),
        airline: {
          id:      r.leg1_airline_id,
          code:    r.leg1_airline_code,
          name:    r.leg1_airline_name,
          logo_url: r.leg1_airline_logo,
        },
        seat: {
          class:               cls,
          available_seats:     r.leg1_available_seats,
          base_price:          leg1Base,
          baggage_included_kg: r.leg1_baggage_included_kg,
          carry_on_kg:         r.leg1_carry_on_kg,
          extra_baggage_price: parseFloat(r.leg1_extra_baggage_price) || 0,
          total_price:         calcTotalPrice(leg1Base, a, c, i),
        },
      },
      leg2: {
        flight_id:        r.leg2_flight_id,
        flight_number:    r.leg2_flight_number,
        departure_time:   r.leg2_departure_time,
        arrival_time:     r.leg2_arrival_time,
        duration_minutes: r.leg2_duration_minutes,
        duration_label:   formatDuration(r.leg2_duration_minutes),
        airline: {
          id:      r.leg2_airline_id,
          code:    r.leg2_airline_code,
          name:    r.leg2_airline_name,
          logo_url: r.leg2_airline_logo,
        },
        seat: {
          class:               cls,
          available_seats:     r.leg2_available_seats,
          base_price:          leg2Base,
          baggage_included_kg: r.leg2_baggage_included_kg,
          carry_on_kg:         r.leg2_carry_on_kg,
          extra_baggage_price: parseFloat(r.leg2_extra_baggage_price) || 0,
          total_price:         calcTotalPrice(leg2Base, a, c, i),
        },
      },
    };
  };

  const layoverFlights = layoverResult.rows.map(formatLayoverFlight);

  return {
    original_flight:    formatOrigFlight(orig),
    passengers:         { adults: a, children: c, infants: i, total: a + c + i },
    seat_class:         cls,
    alternatives: {
      same_route:       sameRouteFlights,
      layover:          layoverFlights,
    },
    total_same_route:   sameRouteFlights.length,
    total_layover:      layoverFlights.length,
    total_alternatives: sameRouteFlights.length + layoverFlights.length,
  };
};

/**
 * GET /api/flights/price-calendar
 * SB-02: Lịch giá vé – giá thấp nhất mỗi ngày trong tháng cho một tuyến
 */
const getPriceCalendar = async (params) => {
  const {
    from, to, month, seat_class = "economy", adults = 1, children = 0, infants = 0,
  } = params;

  if (!from || !to)   throw new Error("from và to (mã sân bay) là bắt buộc");
  if (!month)         throw new Error("month là bắt buộc (định dạng YYYY-MM)");

  const monthRegex = /^\d{4}-\d{2}$/;
  if (!monthRegex.test(month)) throw new Error("month phải có định dạng YYYY-MM");

  const validClasses = ["economy", "business", "first"];
  const cls = seat_class.toLowerCase();
  if (!validClasses.includes(cls)) throw new Error("seat_class phải là một trong: economy, business, first");

  const a = parseInt(adults)   || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;

  if (a < 1)           throw new Error("Phải có ít nhất 1 người lớn");
  if (from.toUpperCase() === to.toUpperCase()) throw new Error("Điểm đi và điểm đến không được trùng nhau");

  // Tính ngày đầu và cuối tháng
  const [year, mon] = month.split("-").map(Number);
  const dateFrom    = `${month}-01`;
  const lastDay     = new Date(year, mon, 0).getDate();
  const dateTo      = `${month}-${String(lastDay).padStart(2, "0")}`;

  const seatsNeeded = a + c;

  const result = await pool.query(QF.SELECT_PRICE_CALENDAR, [
    from, to, dateFrom, dateTo, cls, seatsNeeded,
  ]);

  // Build map ngày → min_price để tính cheapest_in_month / cheapest_in_week
  const rows = result.rows;
  if (rows.length === 0) {
    return {
      from: from.toUpperCase(),
      to:   to.toUpperCase(),
      month,
      seat_class:         cls,
      passengers:         { adults: a, children: c, infants: i, total: a + c + i },
      calendar:           [],
      cheapest_price:     null,
      cheapest_date:      null,
    };
  }

  // Tìm giá thấp nhất toàn tháng
  const allPrices     = rows.map((r) => parseFloat(r.min_price));
  const cheapestPrice = Math.min(...allPrices);
  const cheapestRow   = rows.find((r) => parseFloat(r.min_price) === cheapestPrice);

  // Nhóm theo tuần ISO (Monday-based) để đánh dấu cheapest_in_week
  const weekMap = {};
  rows.forEach((r) => {
    const d   = new Date(r.flight_date);
    const dow = d.getDay() === 0 ? 6 : d.getDay() - 1; // Mon=0 … Sun=6
    const mon = new Date(d); mon.setDate(d.getDate() - dow);
    const key = mon.toISOString().slice(0, 10);
    if (!weekMap[key] || parseFloat(r.min_price) < parseFloat(weekMap[key].min_price)) {
      weekMap[key] = r;
    }
  });
  const cheapestByWeekDates = new Set(Object.values(weekMap).map((r) => {
    const d = new Date(r.flight_date);
    return d.toISOString().slice(0, 10);
  }));

  const calendar = rows.map((r) => {
    const dateStr  = new Date(r.flight_date).toISOString().slice(0, 10);
    const minPrice = parseFloat(r.min_price);
    return {
      date:               dateStr,
      min_price:          minPrice,
      total_price:        calcTotalPrice(minPrice, a, c, i),
      flight_count:       parseInt(r.flight_count),
      cheapest_in_month:  minPrice === cheapestPrice,
      cheapest_in_week:   cheapestByWeekDates.has(dateStr),
    };
  });

  return {
    from:           from.toUpperCase(),
    to:             to.toUpperCase(),
    month,
    seat_class:     cls,
    passengers:     { adults: a, children: c, infants: i, total: a + c + i },
    calendar,
    cheapest_price: cheapestPrice,
    cheapest_date:  new Date(cheapestRow.flight_date).toISOString().slice(0, 10),
  };
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

module.exports = {
  searchFlights,
  getAirports,
  getAirlines,
  getFlightById,
  getAlternativeFlights,
  getPriceCalendar,
  getSeatMap,
};
