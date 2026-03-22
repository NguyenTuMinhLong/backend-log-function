const pool = require("../config/db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Tạo mã booking ngẫu nhiên 8 ký tự (VD: AB123456)
 */
const generateBookingCode = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits  = "0123456789";
  let code = "";
  for (let i = 0; i < 2; i++) code += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 6; i++) code += digits[Math.floor(Math.random() * digits.length)];
  return code;
};

/**
 * Tính tổng tiền theo loại hành khách
 * - Adults:   100%
 * - Children: 75%
 * - Infants:  10%
 */
const calcTotalPrice = (basePrice, adults, children, infants) => {
  const adultTotal   = basePrice * adults;
  const childTotal   = basePrice * 0.75 * children;
  const infantTotal  = basePrice * 0.10 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
};

/**
 * Validate input tạo booking
 */
const validateBookingInput = (data) => {
  const {
    outbound_flight_id, outbound_seat_class,
    return_flight_id,   return_seat_class,
    trip_type,
    adults, children, infants,
    contact_name, contact_email,
    passengers,
  } = data;

  if (!outbound_flight_id)  throw new Error("outbound_flight_id là bắt buộc");
  if (!outbound_seat_class) throw new Error("outbound_seat_class là bắt buộc");
  if (!contact_name)        throw new Error("contact_name là bắt buộc");
  if (!contact_email)       throw new Error("contact_email là bắt buộc");

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contact_email)) throw new Error("contact_email không hợp lệ");

  const validClasses = ["economy", "business", "first"];
  if (!validClasses.includes(outbound_seat_class)) {
    throw new Error("outbound_seat_class phải là economy, business hoặc first");
  }

  if (trip_type === "round_trip") {
    if (!return_flight_id)  throw new Error("return_flight_id là bắt buộc cho khứ hồi");
    if (!return_seat_class) throw new Error("return_seat_class là bắt buộc cho khứ hồi");
    if (!validClasses.includes(return_seat_class)) {
      throw new Error("return_seat_class phải là economy, business hoặc first");
    }
  }

  const a = parseInt(adults)   || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;

  if (a < 1)     throw new Error("Phải có ít nhất 1 người lớn");
  if (c < 0)     throw new Error("Số trẻ em không hợp lệ");
  if (i < 0)     throw new Error("Số em bé không hợp lệ");
  if (a + c > 9) throw new Error("Tổng số hành khách không được quá 9");
  if (i > a)     throw new Error("Số em bé không được nhiều hơn số người lớn");

  // Validate danh sách passengers
  if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
    throw new Error("Danh sách hành khách là bắt buộc");
  }

  const expectedCount = a + c + i;
  // Với khứ hồi: mỗi người có 2 bản ghi (outbound + return)
  const tripMultiplier = trip_type === "round_trip" ? 2 : 1;
  if (passengers.length !== expectedCount * tripMultiplier) {
    throw new Error(
      `Số lượng hành khách không khớp. Cần ${expectedCount * tripMultiplier} bản ghi, nhận được ${passengers.length}`
    );
  }

  for (const p of passengers) {
    if (!p.full_name)       throw new Error("full_name là bắt buộc cho mỗi hành khách");
    if (!p.passenger_type)  throw new Error("passenger_type là bắt buộc cho mỗi hành khách");
    if (!["adult", "child", "infant"].includes(p.passenger_type)) {
      throw new Error("passenger_type phải là adult, child hoặc infant");
    }
    if (!["outbound", "return"].includes(p.flight_type || "outbound")) {
      throw new Error("flight_type phải là outbound hoặc return");
    }
  }
};

/**
 * Kiểm tra ghế còn trống và lấy giá
 */
const checkAndGetSeatInfo = async (client, flightId, seatClass, seatsNeeded) => {
  const result = await client.query(
    `SELECT fs.base_price, fs.available_seats, f.status, f.departure_time
     FROM flight_seats fs
     JOIN flights f ON f.id = fs.flight_id
     WHERE fs.flight_id = $1 AND fs.class = $2`,
    [flightId, seatClass]
  );

  if (result.rows.length === 0) {
    throw new Error(`Không tìm thấy hạng ghế ${seatClass} cho chuyến bay ID ${flightId}`);
  }

  const seat = result.rows[0];

  if (seat.status !== "scheduled") {
    throw new Error(`Chuyến bay ID ${flightId} không còn khả dụng (status: ${seat.status})`);
  }

  const depTime = new Date(seat.departure_time);
  if (depTime <= new Date()) {
    throw new Error(`Chuyến bay ID ${flightId} đã khởi hành`);
  }

  if (seat.available_seats < seatsNeeded) {
    throw new Error(
      `Chuyến bay ID ${flightId} hạng ${seatClass} không đủ ghế. Còn ${seat.available_seats} ghế, cần ${seatsNeeded}`
    );
  }

  return seat;
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Tạo booking mới
 */
const createBooking = async (data, userId = null) => {
  validateBookingInput(data);

  const {
    outbound_flight_id,  outbound_seat_class,
    return_flight_id,    return_seat_class,
    trip_type = "one_way",
    adults   = 1,
    children = 0,
    infants  = 0,
    contact_name, contact_email, contact_phone,
    passengers,
  } = data;

  const a = parseInt(adults);
  const c = parseInt(children) || 0;
  const i = parseInt(infants)  || 0;
  const seatsNeeded = a + c; // infants không chiếm ghế

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Kiểm tra ghế chuyến đi
    const outboundSeat = await checkAndGetSeatInfo(client, outbound_flight_id, outbound_seat_class, seatsNeeded);

    // 2. Kiểm tra ghế chuyến về (nếu khứ hồi)
    let returnSeat = null;
    if (trip_type === "round_trip" && return_flight_id) {
      returnSeat = await checkAndGetSeatInfo(client, return_flight_id, return_seat_class, seatsNeeded);
    }

    // 3. Tính tổng tiền
    const outboundTotal = calcTotalPrice(parseFloat(outboundSeat.base_price), a, c, i);
    const returnTotal   = returnSeat ? calcTotalPrice(parseFloat(returnSeat.base_price), a, c, i) : 0;
    const totalPrice    = outboundTotal + returnTotal;
    const basePrice     = parseFloat(outboundSeat.base_price);

    // 4. Tạo mã booking (đảm bảo unique)
    let bookingCode;
    let isUnique = false;
    while (!isUnique) {
      bookingCode = generateBookingCode();
      const check = await client.query(
        "SELECT id FROM bookings WHERE booking_code = $1",
        [bookingCode]
      );
      if (check.rows.length === 0) isUnique = true;
    }

    // 5. Thời gian giữ ghế (15 phút)
    const heldUntil = new Date(Date.now() + 15 * 60 * 1000);

    // 6. Tạo booking record
    const bookingResult = await client.query(
      `INSERT INTO bookings (
        booking_code, user_id,
        outbound_flight_id, outbound_seat_class,
        return_flight_id,   return_seat_class,
        trip_type,
        total_adults, total_children, total_infants,
        base_price, total_price,
        status, contact_name, contact_email, contact_phone,
        held_until
      ) VALUES (
        $1,  $2,
        $3,  $4,
        $5,  $6,
        $7,
        $8,  $9,  $10,
        $11, $12,
        'pending', $13, $14, $15,
        $16
      ) RETURNING *`,
      [
        bookingCode, userId,
        outbound_flight_id, outbound_seat_class,
        return_flight_id || null, return_seat_class || null,
        trip_type,
        a, c, i,
        basePrice, totalPrice,
        contact_name, contact_email, contact_phone || null,
        heldUntil,
      ]
    );

    const booking = bookingResult.rows[0];

    // 7. Lưu thông tin từng hành khách
    for (const p of passengers) {
      await client.query(
        `INSERT INTO passengers (
          booking_id, flight_type, passenger_type,
          full_name, date_of_birth, gender,
          nationality, passport_number, passport_expiry
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          booking.id,
          p.flight_type || "outbound",
          p.passenger_type,
          p.full_name,
          p.date_of_birth    || null,
          p.gender           || null,
          p.nationality      || null,
          p.passport_number  || null,
          p.passport_expiry  || null,
        ]
      );
    }

    // 8. Giảm số ghế available (giữ ghế tạm)
    await client.query(
      `UPDATE flight_seats
       SET available_seats = available_seats - $1, updated_at = NOW()
       WHERE flight_id = $2 AND class = $3`,
      [seatsNeeded, outbound_flight_id, outbound_seat_class]
    );

    if (trip_type === "round_trip" && return_flight_id) {
      await client.query(
        `UPDATE flight_seats
         SET available_seats = available_seats - $1, updated_at = NOW()
         WHERE flight_id = $2 AND class = $3`,
        [seatsNeeded, return_flight_id, return_seat_class]
      );
    }

    await client.query("COMMIT");

    return {
      booking_code:   booking.booking_code,
      booking_id:     booking.id,
      status:         booking.status,
      trip_type:      booking.trip_type,
      held_until:     booking.held_until,
      contact: {
        name:  booking.contact_name,
        email: booking.contact_email,
        phone: booking.contact_phone,
      },
      passengers: {
        adults:   a,
        children: c,
        infants:  i,
        total:    a + c + i,
      },
      price: {
        base_price:      basePrice,
        outbound_total:  outboundTotal,
        return_total:    returnTotal,
        total_price:     totalPrice,
      },
      message: `Đặt vé thành công! Vui lòng thanh toán trong 15 phút (trước ${heldUntil.toLocaleString("vi-VN")})`,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Lấy chi tiết booking theo mã PNR hoặc ID
 */
const getBookingDetail = async (bookingCode, userId = null) => {
  const result = await pool.query(
    `SELECT
       b.*,
       -- Chuyến đi
       f_out.flight_number   AS outbound_flight_number,
       f_out.departure_time  AS outbound_departure_time,
       f_out.arrival_time    AS outbound_arrival_time,
       f_out.duration_minutes AS outbound_duration,
       al_out.name           AS outbound_airline_name,
       al_out.code           AS outbound_airline_code,
       dep_out.code          AS outbound_dep_code,
       dep_out.city          AS outbound_dep_city,
       arr_out.code          AS outbound_arr_code,
       arr_out.city          AS outbound_arr_city,
       -- Chuyến về
       f_ret.flight_number   AS return_flight_number,
       f_ret.departure_time  AS return_departure_time,
       f_ret.arrival_time    AS return_arrival_time,
       f_ret.duration_minutes AS return_duration,
       al_ret.name           AS return_airline_name,
       al_ret.code           AS return_airline_code,
       dep_ret.code          AS return_dep_code,
       dep_ret.city          AS return_dep_city,
       arr_ret.code          AS return_arr_code,
       arr_ret.city          AS return_arr_city
     FROM bookings b
     -- Join chuyến đi
     JOIN flights  f_out   ON f_out.id  = b.outbound_flight_id
     JOIN airlines al_out  ON al_out.id = f_out.airline_id
     JOIN airports dep_out ON dep_out.id = f_out.departure_airport_id
     JOIN airports arr_out ON arr_out.id = f_out.arrival_airport_id
     -- Join chuyến về (optional)
     LEFT JOIN flights  f_ret   ON f_ret.id  = b.return_flight_id
     LEFT JOIN airlines al_ret  ON al_ret.id = f_ret.airline_id
     LEFT JOIN airports dep_ret ON dep_ret.id = f_ret.departure_airport_id
     LEFT JOIN airports arr_ret ON arr_ret.id = f_ret.arrival_airport_id
     WHERE b.booking_code = $1`,
    [bookingCode]
  );

  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

  const b = result.rows[0];

  // Nếu user đã login → chỉ cho xem booking của mình
  if (userId && b.user_id && b.user_id !== userId) {
    throw new Error("Bạn không có quyền xem booking này");
  }

  // Lấy danh sách hành khách
  const passResult = await pool.query(
    `SELECT * FROM passengers WHERE booking_id = $1 ORDER BY flight_type, passenger_type`,
    [b.id]
  );

  return {
    booking_code: b.booking_code,
    booking_id:   b.id,
    status:       b.status,
    trip_type:    b.trip_type,
    held_until:   b.held_until,
    created_at:   b.created_at,

    contact: {
      name:  b.contact_name,
      email: b.contact_email,
      phone: b.contact_phone,
    },

    outbound_flight: {
      flight_number:  b.outbound_flight_number,
      seat_class:     b.outbound_seat_class,
      airline:        { code: b.outbound_airline_code, name: b.outbound_airline_name },
      departure:      { code: b.outbound_dep_code, city: b.outbound_dep_city, time: b.outbound_departure_time },
      arrival:        { code: b.outbound_arr_code, city: b.outbound_arr_city, time: b.outbound_arrival_time },
      duration_minutes: b.outbound_duration,
    },

    return_flight: b.return_flight_id ? {
      flight_number:  b.return_flight_number,
      seat_class:     b.return_seat_class,
      airline:        { code: b.return_airline_code, name: b.return_airline_name },
      departure:      { code: b.return_dep_code, city: b.return_dep_city, time: b.return_departure_time },
      arrival:        { code: b.return_arr_code, city: b.return_arr_city, time: b.return_arrival_time },
      duration_minutes: b.return_duration,
    } : null,

    passengers: {
      adults:   b.total_adults,
      children: b.total_children,
      infants:  b.total_infants,
      list:     passResult.rows,
    },

    price: {
      base_price:  parseFloat(b.base_price),
      total_price: parseFloat(b.total_price),
    },
  };
};

/**
 * Lấy lịch sử booking của user đã đăng nhập
 */
const getMyBookings = async (userId) => {
  const result = await pool.query(
    `SELECT
       b.booking_code, b.status, b.trip_type,
       b.total_adults, b.total_children, b.total_infants,
       b.total_price, b.held_until, b.created_at,
       f_out.flight_number  AS outbound_flight_number,
       f_out.departure_time AS outbound_departure_time,
       dep_out.city         AS outbound_dep_city,
       arr_out.city         AS outbound_arr_city,
       al_out.name          AS outbound_airline_name
     FROM bookings b
     JOIN flights  f_out   ON f_out.id   = b.outbound_flight_id
     JOIN airports dep_out ON dep_out.id = f_out.departure_airport_id
     JOIN airports arr_out ON arr_out.id = f_out.arrival_airport_id
     JOIN airlines al_out  ON al_out.id  = f_out.airline_id
     WHERE b.user_id = $1
     ORDER BY b.created_at DESC`,
    [userId]
  );

  return result.rows;
};

/**
 * Hủy booking
 */
const cancelBooking = async (bookingCode, userId = null) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      "SELECT * FROM bookings WHERE booking_code = $1 FOR UPDATE",
      [bookingCode]
    );

    if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

    const booking = result.rows[0];

    // Kiểm tra quyền
    if (userId && booking.user_id && booking.user_id !== userId) {
      throw new Error("Bạn không có quyền hủy booking này");
    }

    if (booking.status === "cancelled") throw new Error("Booking đã bị hủy trước đó");
    if (booking.status === "expired")   throw new Error("Booking đã hết hạn");

    const seatsNeeded = booking.total_adults + booking.total_children;

    // Hoàn ghế chuyến đi
    await client.query(
      `UPDATE flight_seats
       SET available_seats = available_seats + $1, updated_at = NOW()
       WHERE flight_id = $2 AND class = $3`,
      [seatsNeeded, booking.outbound_flight_id, booking.outbound_seat_class]
    );

    // Hoàn ghế chuyến về
    if (booking.return_flight_id) {
      await client.query(
        `UPDATE flight_seats
         SET available_seats = available_seats + $1, updated_at = NOW()
         WHERE flight_id = $2 AND class = $3`,
        [seatsNeeded, booking.return_flight_id, booking.return_seat_class]
      );
    }

    // Cập nhật trạng thái
    await client.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [booking.id]
    );

    await client.query("COMMIT");

    return { message: `Booking ${bookingCode} đã được hủy thành công` };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Tự động hủy các booking hết hạn giữ ghế (gọi định kỳ)
 */
const expireHeldBookings = async () => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Tìm booking pending đã hết thời gian giữ ghế
    const expired = await client.query(
      `SELECT * FROM bookings
       WHERE status = 'pending' AND held_until < NOW()
       FOR UPDATE SKIP LOCKED`
    );

    for (const booking of expired.rows) {
      const seatsNeeded = booking.total_adults + booking.total_children;

      // Hoàn ghế chuyến đi
      await client.query(
        `UPDATE flight_seats
         SET available_seats = available_seats + $1, updated_at = NOW()
         WHERE flight_id = $2 AND class = $3`,
        [seatsNeeded, booking.outbound_flight_id, booking.outbound_seat_class]
      );

      // Hoàn ghế chuyến về
      if (booking.return_flight_id) {
        await client.query(
          `UPDATE flight_seats
           SET available_seats = available_seats + $1, updated_at = NOW()
           WHERE flight_id = $2 AND class = $3`,
          [seatsNeeded, booking.return_flight_id, booking.return_seat_class]
        );
      }

      // Đánh dấu expired
      await client.query(
        `UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1`,
        [booking.id]
      );
    }

    await client.query("COMMIT");

    if (expired.rows.length > 0) {
      console.log(`[Auto-expire] Đã hủy ${expired.rows.length} booking hết hạn`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[Auto-expire] Lỗi:", err.message);
  } finally {
    client.release();
  }
};

module.exports = {
  createBooking,
  getBookingDetail,
  getMyBookings,
  cancelBooking,
  expireHeldBookings,
};