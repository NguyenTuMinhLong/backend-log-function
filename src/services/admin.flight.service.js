const pool = require("../config/db");

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

  if (status)         { conditions.push(`f.status = $${idx++}`);                       values.push(status); }
  if (airline_code)   { conditions.push(`al.code = $${idx++}`);                        values.push(airline_code.toUpperCase()); }
  if (departure_code) { conditions.push(`dep.code = $${idx++}`);                       values.push(departure_code.toUpperCase()); }
  if (arrival_code)   { conditions.push(`arr.code = $${idx++}`);                       values.push(arrival_code.toUpperCase()); }
  if (departure_date) { conditions.push(`DATE(f.departure_time) = $${idx++}`);         values.push(departure_date); }
  if (flight_number)  { conditions.push(`f.flight_number ILIKE $${idx++}`);            values.push(`%${flight_number}%`); }

  // Mặc định không hiện chuyến bay đã bị ẩn (is_active = false)
  // Admin muốn xem tất cả thì truyền show_hidden=true
  if (!params.show_hidden) {
    conditions.push(`f.is_active = TRUE`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM flights f
     JOIN airlines al ON al.id = f.airline_id
     JOIN airports dep ON dep.id = f.departure_airport_id
     JOIN airports arr ON arr.id = f.arrival_airport_id
     ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count);

  // Query data
  const dataResult = await pool.query(
    `SELECT
       f.id, f.flight_number, f.departure_time, f.arrival_time,
       f.duration_minutes, f.status, f.is_active, f.created_at, f.updated_at,
       al.id   AS airline_id,   al.code  AS airline_code,  al.name AS airline_name,
       dep.id  AS dep_id,       dep.code AS dep_code,      dep.city AS dep_city,
       arr.id  AS arr_id,       arr.code AS arr_code,      arr.city AS arr_city,
       -- Tổng hợp seats
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
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, parseInt(limit), offset]
  );

  return {
    data:        dataResult.rows,
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

    // Kiểm tra airline + airport tồn tại
    const airlineCheck = await client.query("SELECT id FROM airlines WHERE id=$1 AND is_active=TRUE", [airline_id]);
    if (airlineCheck.rows.length === 0) throw new Error("Hãng hàng không không tồn tại hoặc đã bị vô hiệu");

    const depCheck = await client.query("SELECT id FROM airports WHERE id=$1 AND is_active=TRUE", [departure_airport_id]);
    if (depCheck.rows.length === 0) throw new Error("Sân bay đi không tồn tại");

    const arrCheck = await client.query("SELECT id FROM airports WHERE id=$1 AND is_active=TRUE", [arrival_airport_id]);
    if (arrCheck.rows.length === 0) throw new Error("Sân bay đến không tồn tại");

    // Tạo flight
    const flightResult = await client.query(
      `INSERT INTO flights (
         flight_number, airline_id,
         departure_airport_id, arrival_airport_id,
         departure_time, arrival_time,
         duration_minutes, status
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,'scheduled')
       RETURNING *`,
      [
        flight_number, airline_id,
        departure_airport_id, arrival_airport_id,
        departure_time, arrival_time,
        parseInt(duration_minutes),
      ]
    );

    const flight = flightResult.rows[0];

    // Tạo seats
    for (const s of seats) {
      const totalSeats = parseInt(s.total_seats);
      const available  = s.available_seats !== undefined
        ? parseInt(s.available_seats)
        : totalSeats;

      await client.query(
        `INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price)
         VALUES ($1,$2,$3,$4,$5)`,
        [flight.id, s.class, totalSeats, available, parseFloat(s.base_price)]
      );
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
    seats, // array: [{ class, base_price, total_seats }]
  } = data;

  validateFlightInput(data, true);
  if (seats) validateSeats(seats);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Kiểm tra flight tồn tại
    const existing = await client.query("SELECT * FROM flights WHERE id=$1", [flightId]);
    if (existing.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

    // Build dynamic UPDATE
    const fields  = [];
    const values  = [];
    let   idx     = 1;

    if (flight_number)        { fields.push(`flight_number=$${idx++}`);          values.push(flight_number); }
    if (airline_id)           { fields.push(`airline_id=$${idx++}`);             values.push(airline_id); }
    if (departure_airport_id) { fields.push(`departure_airport_id=$${idx++}`);   values.push(departure_airport_id); }
    if (arrival_airport_id)   { fields.push(`arrival_airport_id=$${idx++}`);     values.push(arrival_airport_id); }
    if (departure_time)       { fields.push(`departure_time=$${idx++}`);         values.push(departure_time); }
    if (arrival_time)         { fields.push(`arrival_time=$${idx++}`);           values.push(arrival_time); }
    if (duration_minutes)     { fields.push(`duration_minutes=$${idx++}`);       values.push(parseInt(duration_minutes)); }

    if (fields.length > 0) {
      fields.push(`updated_at=NOW()`);
      values.push(flightId);
      await client.query(
        `UPDATE flights SET ${fields.join(", ")} WHERE id=$${idx}`,
        values
      );
    }

    // Cập nhật giá + ghế từng hạng
    if (seats && seats.length > 0) {
      for (const s of seats) {
        const existing_seat = await client.query(
          "SELECT id FROM flight_seats WHERE flight_id=$1 AND class=$2",
          [flightId, s.class]
        );

        if (existing_seat.rows.length > 0) {
          // Đã có → UPDATE
          const seatFields  = [];
          const seatValues  = [];
          let   sidx        = 1;

          if (s.base_price   !== undefined) { seatFields.push(`base_price=$${sidx++}`);   seatValues.push(parseFloat(s.base_price)); }
          if (s.total_seats  !== undefined) { seatFields.push(`total_seats=$${sidx++}`);  seatValues.push(parseInt(s.total_seats)); }

          if (seatFields.length > 0) {
            seatFields.push(`updated_at=NOW()`);
            seatValues.push(flightId, s.class);
            await client.query(
              `UPDATE flight_seats SET ${seatFields.join(", ")}
               WHERE flight_id=$${sidx++} AND class=$${sidx++}`,
              seatValues
            );
          }
        } else {
          // Chưa có → INSERT
          const totalSeats = parseInt(s.total_seats) || 0;
          await client.query(
            `INSERT INTO flight_seats (flight_id,class,total_seats,available_seats,base_price)
             VALUES ($1,$2,$3,$3,$4)`,
            [flightId, s.class, totalSeats, parseFloat(s.base_price)]
          );
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

  const result = await pool.query(
    `UPDATE flights SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING id, flight_number, status`,
    [status, flightId]
  );

  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  return {
    message:       `Đã chuyển trạng thái chuyến bay thành ${status}`,
    flight_id:     result.rows[0].id,
    flight_number: result.rows[0].flight_number,
    status:        result.rows[0].status,
  };
};

/**
 * Ẩn/hiện chuyến bay (soft delete)
 */
const toggleFlightVisibility = async (flightId) => {
  const existing = await pool.query("SELECT id, flight_number, is_active FROM flights WHERE id=$1", [flightId]);
  if (existing.rows.length === 0) throw new Error("Không tìm thấy chuyến bay");

  const current   = existing.rows[0];
  const newStatus = !current.is_active;

  await pool.query(
    "UPDATE flights SET is_active=$1, updated_at=NOW() WHERE id=$2",
    [newStatus, flightId]
  );

  return {
    message:       newStatus ? "Đã hiện chuyến bay" : "Đã ẩn chuyến bay",
    flight_id:     current.id,
    flight_number: current.flight_number,
    is_active:     newStatus,
  };
};

module.exports = {
  getFlights,
  createFlight,
  updateFlight,
  updateFlightStatus,
  toggleFlightVisibility,
};