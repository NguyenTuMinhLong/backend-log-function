const pool = require("../config/db");
const QA   = require("../queries/airline.queries");
const QAP  = require("../queries/airport.queries");
const QF   = require("../queries/flight.queries");
const QB   = require("../queries/booking.queries");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_STATUSES = ["scheduled", "delayed", "cancelled", "completed"];
const VALID_CLASSES  = ["economy", "business", "first"];

const validateFlightInput = (data, isUpdate = false) => {
  const {
    flight_number, airline_id,
    departure_airport_id, arrival_airport_id,
    departure_time, arrival_time,
    duration_minutes,
  } = data;

  if (!isUpdate) {
    if (!flight_number)          throw new Error("flight_number là bắt buộc");
    if (!airline_id)             throw new Error("airline_id là bắt buộc");
    if (!departure_airport_id)   throw new Error("departure_airport_id là bắt buộc");
    if (!arrival_airport_id)     throw new Error("arrival_airport_id là bắt buộc");
    if (!departure_time)         throw new Error("departure_time là bắt buộc");
    if (!arrival_time)           throw new Error("arrival_time là bắt buộc");
    if (!duration_minutes)       throw new Error("duration_minutes là bắt buộc");
  }

  if (departure_airport_id && arrival_airport_id &&
      parseInt(departure_airport_id) === parseInt(arrival_airport_id)) {
    throw new Error("Điểm đi và điểm đến không được trùng nhau");
  }

  if (departure_time && arrival_time) {
    if (new Date(arrival_time) <= new Date(departure_time)) {
      throw new Error("arrival_time phải sau departure_time");
    }
  }

  if (duration_minutes && parseInt(duration_minutes) <= 0) {
    throw new Error("duration_minutes phải lớn hơn 0");
  }
};

const validateSeats = (seats) => {
  if (!seats || !Array.isArray(seats) || seats.length === 0) return;

  for (const s of seats) {
    if (!VALID_CLASSES.includes(s.class)) {
      throw new Error(`class phải là: ${VALID_CLASSES.join(", ")}`);
    }
    if (!s.total_seats || parseInt(s.total_seats) <= 0) {
      throw new Error("total_seats phải lớn hơn 0");
    }
    if (!s.base_price || parseFloat(s.base_price) < 0) {
      throw new Error("base_price không hợp lệ");
    }
  }
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Xem danh sách chuyến bay (admin) - có filter + phân trang
 */
const getFlights = async (params) => {
  const {
    page        = 1,
    limit       = 10,
    status,
    airline_code,
    departure_code,
    arrival_code,
    departure_date,
    flight_number,
  } = params;

  const offset = (parseInt(page) - 1) * parseInt(limit);

  const conditions = [];
  const values     = [];
  let   idx        = 1;

  if (status)         { conditions.push(`f.status = $${idx++}`);               values.push(status); }
  if (airline_code)   { conditions.push(`al.code = $${idx++}`);                values.push(airline_code.toUpperCase()); }
  if (departure_code) { conditions.push(`dep.code = $${idx++}`);               values.push(departure_code.toUpperCase()); }
  if (arrival_code)   { conditions.push(`arr.code = $${idx++}`);               values.push(arrival_code.toUpperCase()); }
  if (departure_date) { conditions.push(`DATE(f.departure_time) = $${idx++}`); values.push(departure_date); }
  if (flight_number)  { conditions.push(`f.flight_number ILIKE $${idx++}`);    values.push(`%${flight_number}%`); }

  if (!params.show_hidden) {
    conditions.push(`f.is_active = TRUE`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(QF.COUNT_FLIGHTS(whereClause), values);
  const total       = parseInt(countResult.rows[0].count);

  const dataResult = await pool.query(
    QF.SELECT_FLIGHTS(whereClause, idx, idx + 1),
    [...values, parseInt(limit), offset]
  );

  return {
    data:       dataResult.rows,
    pagination: {
      total,
      page:        parseInt(page),
      limit:       parseInt(limit),
      total_pages: Math.ceil(total / parseInt(limit)),
    },
  };
};

/**
 * Tạo chuyến bay mới (kèm seats)
 */
const createFlight = async (data) => {
  const {
    flight_number, airline_id,
    departure_airport_id, arrival_airport_id,
    departure_time, arrival_time,
    duration_minutes,
    seats = [],
  } = data;

  validateFlightInput(data);
  validateSeats(seats);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const airlineCheck = await client.query(QA.FIND_ACTIVE_AIRLINE_BY_ID, [airline_id]);
    if (airlineCheck.rows.length === 0) throw new Error("Hãng hàng không không tồn tại hoặc đã bị vô hiệu");

    const depCheck = await client.query(QAP.FIND_ACTIVE_AIRPORT_BY_ID, [departure_airport_id]);
    if (depCheck.rows.length === 0) throw new Error("Sân bay đi không tồn tại");

    const arrCheck = await client.query(QAP.FIND_ACTIVE_AIRPORT_BY_ID, [arrival_airport_id]);
    if (arrCheck.rows.length === 0) throw new Error("Sân bay đến không tồn tại");

    const flightResult = await client.query(QF.INSERT_FLIGHT, [
      flight_number, airline_id,
      departure_airport_id, arrival_airport_id,
      departure_time, arrival_time,
      parseInt(duration_minutes),
    ]);

    const flight = flightResult.rows[0];

    for (const s of seats) {
      const totalSeats = parseInt(s.total_seats);
      const available  = s.available_seats !== undefined ? parseInt(s.available_seats) : totalSeats;

      const defaultBaggage = {
        economy:  { baggage_included_kg: 23, carry_on_kg: 7,  extra_baggage_price: 250000 },
        business: { baggage_included_kg: 32, carry_on_kg: 10, extra_baggage_price: 150000 },
        first:    { baggage_included_kg: 40, carry_on_kg: 14, extra_baggage_price: 0      },
      };
      const def = defaultBaggage[s.class] || defaultBaggage.economy;

      const baggageIncludedKg = s.baggage_included_kg  !== undefined ? parseInt(s.baggage_included_kg)   : def.baggage_included_kg;
      const carryOnKg         = s.carry_on_kg          !== undefined ? parseInt(s.carry_on_kg)           : def.carry_on_kg;
      const extraBaggagePrice = s.extra_baggage_price  !== undefined ? parseFloat(s.extra_baggage_price) : def.extra_baggage_price;

      await client.query(QF.INSERT_FLIGHT_SEAT, [
        flight.id, s.class, totalSeats, available, parseFloat(s.base_price),
        baggageIncludedKg, carryOnKg, extraBaggagePrice,
      ]);
    }

    await client.query("COMMIT");
    return { flight_id: flight.id, flight_number: flight.flight_number, status: flight.status };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Cập nhật thông tin chuyến bay (giờ bay, giá vé theo hạng)
 */
const updateFlight = async (flightId, data) => {
  const {
    flight_number, airline_id,
    departure_airport_id, arrival_airport_id,
    departure_time, arrival_time,
    duration_minutes,
    seats,
  } = data;

  validateFlightInput(data, true);
  if (seats) validateSeats(seats);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(QF.FIND_FLIGHT_BY_ID, [flightId]);
    if (existing.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

    const fields = [];
    const values = [];
    let   idx    = 1;

    if (flight_number)        { fields.push(`flight_number=$${idx++}`);         values.push(flight_number); }
    if (airline_id)           { fields.push(`airline_id=$${idx++}`);            values.push(airline_id); }
    if (departure_airport_id) { fields.push(`departure_airport_id=$${idx++}`);  values.push(departure_airport_id); }
    if (arrival_airport_id)   { fields.push(`arrival_airport_id=$${idx++}`);    values.push(arrival_airport_id); }
    if (departure_time)       { fields.push(`departure_time=$${idx++}`);        values.push(departure_time); }
    if (arrival_time)         { fields.push(`arrival_time=$${idx++}`);          values.push(arrival_time); }
    if (duration_minutes)     { fields.push(`duration_minutes=$${idx++}`);      values.push(parseInt(duration_minutes)); }

    if (fields.length > 0) {
      fields.push(`updated_at=NOW()`);
      values.push(flightId);
      await client.query(QF.UPDATE_FLIGHT_FIELDS(fields, idx), values);
    }

    if (seats && seats.length > 0) {
      for (const s of seats) {
        const existingSeat = await client.query(QF.FIND_FLIGHT_SEAT, [flightId, s.class]);

        if (existingSeat.rows.length > 0) {
          const seatFields = [];
          const seatValues = [];
          let   sidx       = 1;

          if (s.base_price          !== undefined) { seatFields.push(`base_price=$${sidx++}`);          seatValues.push(parseFloat(s.base_price)); }
          if (s.total_seats         !== undefined) { seatFields.push(`total_seats=$${sidx++}`);         seatValues.push(parseInt(s.total_seats)); }
          if (s.baggage_included_kg !== undefined) { seatFields.push(`baggage_included_kg=$${sidx++}`); seatValues.push(parseInt(s.baggage_included_kg)); }
          if (s.carry_on_kg         !== undefined) { seatFields.push(`carry_on_kg=$${sidx++}`);         seatValues.push(parseInt(s.carry_on_kg)); }
          if (s.extra_baggage_price !== undefined) { seatFields.push(`extra_baggage_price=$${sidx++}`); seatValues.push(parseFloat(s.extra_baggage_price)); }

          if (seatFields.length > 0) {
            seatFields.push(`updated_at=NOW()`);
            seatValues.push(flightId, s.class);
            await client.query(QF.UPDATE_FLIGHT_SEAT_FIELDS(seatFields, sidx), seatValues);
          }
        } else {
          const totalSeats = parseInt(s.total_seats) || 0;
          const defaultBaggage2 = {
            economy:  { baggage_included_kg: 23, carry_on_kg: 7,  extra_baggage_price: 40000 },
            business: { baggage_included_kg: 32, carry_on_kg: 12, extra_baggage_price: 40000 },
            first:    { baggage_included_kg: 40, carry_on_kg: 15, extra_baggage_price: 40000 },
          };
          const def2 = defaultBaggage2[s.class] || defaultBaggage2.economy;
          await client.query(QF.INSERT_FLIGHT_SEAT_UPSERT, [
            flightId, s.class, totalSeats, parseFloat(s.base_price),
            s.baggage_included_kg !== undefined ? parseInt(s.baggage_included_kg) : def2.baggage_included_kg,
            s.carry_on_kg         !== undefined ? parseInt(s.carry_on_kg)         : def2.carry_on_kg,
            s.extra_baggage_price !== undefined ? parseFloat(s.extra_baggage_price) : def2.extra_baggage_price,
          ]);
        }
      }
    }

    await client.query("COMMIT");
    return { message: "Cập nhật chuyến bay thành công", flight_id: parseInt(flightId) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Chuyển trạng thái chuyến bay
 */
const updateFlightStatus = async (flightId, status) => {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`status phải là: ${VALID_STATUSES.join(", ")}`);
  }

  const result = await pool.query(QF.UPDATE_FLIGHT_STATUS, [status, flightId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  return {
    message:       `Đã chuyển trạng thái chuyến bay thành "${status}"`,
    flight_id:     result.rows[0].id,
    flight_number: result.rows[0].flight_number,
    status:        result.rows[0].status,
  };
};

/**
 * Ẩn/hiện chuyến bay (soft delete)
 */
const toggleFlightVisibility = async (flightId) => {
  const existing = await pool.query(QF.FIND_FLIGHT_VISIBILITY, [flightId]);
  if (existing.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const current   = existing.rows[0];
  const newStatus = !current.is_active;

  await pool.query(QF.SET_FLIGHT_VISIBILITY, [newStatus, flightId]);

  return {
    message:       newStatus ? "Đã hiện chuyến bay" : "Đã ẩn chuyến bay",
    flight_id:     current.id,
    flight_number: current.flight_number,
    is_active:     newStatus,
  };
};

// ══════════════════════════════════════════════════════
// A-02: Manage Airports
// ══════════════════════════════════════════════════════

const getAirports = async (params) => {
  const { page = 1, limit = 20, country, city, is_active } = params;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = []; const values = []; let idx = 1;

  if (country)   { conditions.push(`LOWER(country) LIKE LOWER($${idx++})`); values.push(`%${country}%`); }
  if (city)      { conditions.push(`LOWER(city) LIKE LOWER($${idx++})`);    values.push(`%${city}%`); }
  if (is_active !== undefined) { conditions.push(`is_active = $${idx++}`);   values.push(is_active === "true"); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query(QAP.COUNT_AIRPORTS(whereClause), values);
  const total    = parseInt(countRes.rows[0].count);

  const dataRes = await pool.query(
    QAP.SELECT_AIRPORTS_ALL(whereClause, idx, idx + 1),
    [...values, parseInt(limit), offset]
  );

  return { data: dataRes.rows, pagination: { total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / parseInt(limit)) } };
};

const createAirport = async (data) => {
  const { code, name, city, country = "Vietnam", timezone = "Asia/Ho_Chi_Minh" } = data;
  if (!code || !name || !city) throw new Error("code, name, city là bắt buộc");

  const result = await pool.query(QAP.INSERT_AIRPORT, [code.toUpperCase(), name, city, country, timezone]);
  return result.rows[0];
};

const updateAirport = async (airportId, data) => {
  const { name, city, country, timezone } = data;
  const fields = []; const values = []; let idx = 1;

  if (name)     { fields.push(`name=$${idx++}`);     values.push(name); }
  if (city)     { fields.push(`city=$${idx++}`);     values.push(city); }
  if (country)  { fields.push(`country=$${idx++}`);  values.push(country); }
  if (timezone) { fields.push(`timezone=$${idx++}`); values.push(timezone); }

  if (fields.length === 0) throw new Error("Không có thông tin nào để cập nhật");

  values.push(airportId);
  const result = await pool.query(QAP.UPDATE_AIRPORT_FIELDS(fields, idx), values);
  if (result.rows.length === 0) throw new Error("Không tìm thấy sân bay");
  return result.rows[0];
};

const toggleAirportStatus = async (airportId) => {
  const result = await pool.query(QAP.TOGGLE_AIRPORT_STATUS, [airportId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy sân bay");
  const r = result.rows[0];
  return { message: r.is_active ? "Đã kích hoạt sân bay" : "Đã vô hiệu hóa sân bay", ...r };
};

// ══════════════════════════════════════════════════════
// A-03: Manage Airlines
// ══════════════════════════════════════════════════════

const getAirlinesAdmin = async (params) => {
  const { page = 1, limit = 20, is_active } = params;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = []; const values = []; let idx = 1;

  if (is_active !== undefined) { conditions.push(`is_active = $${idx++}`); values.push(is_active === "true"); }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query(QA.COUNT_AIRLINES(whereClause), values);
  const total    = parseInt(countRes.rows[0].count);

  const dataRes = await pool.query(
    QA.SELECT_AIRLINES_ALL(whereClause, idx, idx + 1),
    [...values, parseInt(limit), offset]
  );

  return { data: dataRes.rows, pagination: { total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / parseInt(limit)) } };
};

const createAirline = async (data) => {
  const { code, name, logo_url } = data;
  if (!code || !name) throw new Error("code, name là bắt buộc");

  const result = await pool.query(QA.INSERT_AIRLINE_SIMPLE, [code.toUpperCase(), name, logo_url || null]);
  return result.rows[0];
};

const updateAirline = async (airlineId, data) => {
  const { name, logo_url } = data;
  const fields = []; const values = []; let idx = 1;

  if (name)                   { fields.push(`name=$${idx++}`);     values.push(name); }
  if (logo_url !== undefined) { fields.push(`logo_url=$${idx++}`); values.push(logo_url); }

  if (fields.length === 0) throw new Error("Không có thông tin nào để cập nhật");

  values.push(airlineId);
  const result = await pool.query(QA.UPDATE_AIRLINE_FIELDS(fields, idx), values);
  if (result.rows.length === 0) throw new Error("Không tìm thấy hãng hàng không");
  return result.rows[0];
};

const toggleAirlineStatus = async (airlineId) => {
  const result = await pool.query(QA.TOGGLE_AIRLINE_STATUS, [airlineId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy hãng hàng không");
  const r = result.rows[0];
  return { message: r.is_active ? "Đã kích hoạt hãng bay" : "Đã vô hiệu hóa hãng bay", ...r };
};

// ══════════════════════════════════════════════════════
// A-06: Manage Bookings
// ══════════════════════════════════════════════════════

const getBookings = async (params) => {
  const { page = 1, limit = 10, status, trip_type, search } = params;
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const conditions = []; const values = []; let idx = 1;

  if (status)    { conditions.push(`b.status = $${idx++}`);    values.push(status); }
  if (trip_type) { conditions.push(`b.trip_type = $${idx++}`); values.push(trip_type); }
  if (search)    {
    conditions.push(`(b.booking_code ILIKE $${idx} OR b.contact_email ILIKE $${idx} OR b.contact_name ILIKE $${idx})`);
    idx++;
    values.push(`%${search}%`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countRes = await pool.query(QB.COUNT_BOOKINGS(whereClause), values);
  const total    = parseInt(countRes.rows[0].count);

  const dataRes = await pool.query(
    QB.SELECT_BOOKINGS_ADMIN(whereClause, idx, idx + 1),
    [...values, parseInt(limit), offset]
  );

  return { data: dataRes.rows, pagination: { total, page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(total / parseInt(limit)) } };
};

const getBookingDetailAdmin = async (bookingId) => {
  const result = await pool.query(QB.SELECT_BOOKING_DETAIL_ADMIN, [bookingId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

  const passengers = await pool.query(QB.SELECT_ALL_PASSENGERS_BY_BOOKING, [bookingId]);
  return { ...result.rows[0], passengers: passengers.rows };
};

const updateBookingStatus = async (bookingId, status) => {
  const validStatuses = ["pending", "confirmed", "cancelled", "expired"];
  if (!validStatuses.includes(status)) throw new Error(`status phải là: ${validStatuses.join(", ")}`);

  const result = await pool.query(QB.UPDATE_BOOKING_STATUS, [status, bookingId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");
  return { message: `Đã cập nhật trạng thái booking thành "${status}"`, ...result.rows[0] };
};

// ══════════════════════════════════════════════════════
// A-07: Reports / Statistics
// ══════════════════════════════════════════════════════

const getStatistics = async (params) => {
  const { from_date, to_date } = params;

  const dateValues  = [];
  let   dateFilter  = "";
  let   bDateFilter = "";

  if (from_date && to_date) {
    dateValues.push(from_date, to_date);
    dateFilter  = `AND created_at BETWEEN $1 AND $2`;
    bDateFilter = `AND b.created_at BETWEEN $1 AND $2`;
  }

  const bookingSummary = await pool.query(QB.STATS_BOOKING_SUMMARY(dateFilter),  dateValues);
  const dailyRevenue   = await pool.query(QB.STATS_DAILY_REVENUE(dateFilter),    dateValues);
  const popularFlights = await pool.query(QB.STATS_POPULAR_FLIGHTS(bDateFilter), dateValues);
  const overview       = await pool.query(QB.STATS_OVERVIEW(dateFilter),         dateValues);

  return {
    overview:        overview.rows[0],
    booking_summary: bookingSummary.rows,
    daily_revenue:   dailyRevenue.rows,
    popular_flights: popularFlights.rows,
  };
};

module.exports = {
  // A-01
  getFlights, createFlight, updateFlight, updateFlightStatus, toggleFlightVisibility,
  // A-02
  getAirports, createAirport, updateAirport, toggleAirportStatus,
  // A-03
  getAirlinesAdmin, createAirline, updateAirline, toggleAirlineStatus,
  // A-06
  getBookings, getBookingDetailAdmin, updateBookingStatus,
  // A-07
  getStatistics,
};
