const pool = require("../config/db");
const { assignSeat } = require("../utils/seat");
const { rollbackReservedVoucherUsageForBooking } = require("./payment.service");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const generateBookingCode = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits  = "0123456789";
  let code = "";
  for (let i = 0; i < 2; i++)
    code += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 6; i++)
    code += digits[Math.floor(Math.random() * digits.length)];
  return code;
};

const calcTotalPrice = (basePrice, adults, children, infants) => {
  const adultTotal  = basePrice * adults;
  const childTotal  = basePrice * 0.75 * children;
  const infantTotal = basePrice * 0.1 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
};

const validateBookingInput = (data) => {
  const {
    outbound_flight_id, outbound_seat_class,
    return_flight_id, return_seat_class,
    trip_type, adults, children, infants,
    contact_name, contact_email, passengers,
  } = data;

  if (!outbound_flight_id) throw new Error("outbound_flight_id là bắt buộc");
  if (!outbound_seat_class) throw new Error("outbound_seat_class là bắt buộc");
  if (!contact_name)        throw new Error("contact_name là bắt buộc");
  if (!contact_email)       throw new Error("contact_email là bắt buộc");

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contact_email))
    throw new Error("contact_email không hợp lệ");

  const validClasses = ["economy", "business", "first"];
  if (!validClasses.includes(outbound_seat_class))
    throw new Error("outbound_seat_class phải là economy, business hoặc first");

  if (trip_type === "round_trip") {
    if (!return_flight_id)  throw new Error("return_flight_id là bắt buộc cho khứ hồi");
    if (!return_seat_class) throw new Error("return_seat_class là bắt buộc cho khứ hồi");
    if (!validClasses.includes(return_seat_class))
      throw new Error("return_seat_class phải là economy, business hoặc first");
  }

  const a = parseInt(adults) || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants) || 0;

  if (a < 1)       throw new Error("Phải có ít nhất 1 người lớn");
  if (c < 0)       throw new Error("Số trẻ em không hợp lệ");
  if (i < 0)       throw new Error("Số em bé không hợp lệ");
  if (a + c > 9)   throw new Error("Tổng số hành khách không được quá 9");
  if (i > a)       throw new Error("Số em bé không được nhiều hơn số người lớn");

  if (!passengers || !Array.isArray(passengers) || passengers.length === 0)
    throw new Error("Danh sách hành khách là bắt buộc");

  const expectedCount  = a + c + i;
  const tripMultiplier = trip_type === "round_trip" ? 2 : 1;
  if (passengers.length !== expectedCount * tripMultiplier)
    throw new Error(
      `Số lượng hành khách không khớp. Cần ${expectedCount * tripMultiplier}, nhận ${passengers.length}`,
    );

  for (const p of passengers) {
    if (!p.full_name)       throw new Error("full_name là bắt buộc cho mỗi hành khách");
    if (!p.passenger_type)  throw new Error("passenger_type là bắt buộc cho mỗi hành khách");
    if (!["adult", "child", "infant"].includes(p.passenger_type))
      throw new Error("passenger_type phải là adult, child hoặc infant");
    if (!["outbound", "return"].includes(p.flight_type || "outbound"))
      throw new Error("flight_type phải là outbound hoặc return");
    if (p.extra_baggage_kg !== undefined && parseInt(p.extra_baggage_kg) < 0)
      throw new Error("extra_baggage_kg không hợp lệ");
  }
};

const checkAndGetSeatInfo = async (client, flightId, seatClass, seatsNeeded) => {
  const result = await client.query(
    `SELECT fs.base_price, fs.available_seats, fs.total_seats,
            fs.baggage_included_kg, fs.carry_on_kg, fs.extra_baggage_price,
            f.status, f.departure_time
     FROM flight_seats fs
     JOIN flights f ON f.id = fs.flight_id
     WHERE fs.flight_id = $1 AND fs.class = $2`,
    [flightId, seatClass],
  );

  if (result.rows.length === 0)
    throw new Error(`Không tìm thấy hạng ghế ${seatClass} cho chuyến bay ID ${flightId}`);

  const seat = result.rows[0];
  if (seat.status !== "scheduled")
    throw new Error(`Chuyến bay ID ${flightId} không còn khả dụng (status: ${seat.status})`);

  const depTime = new Date(seat.departure_time);
  if (depTime <= new Date())
    throw new Error(`Chuyến bay ID ${flightId} đã khởi hành`);

  if (seat.available_seats < seatsNeeded)
    throw new Error(
      `Chuyến bay ID ${flightId} hạng ${seatClass} không đủ ghế. Còn ${seat.available_seats}, cần ${seatsNeeded}`,
    );

  return seat;
};

// ─── createBooking ────────────────────────────────────────────────────────────

const createBooking = async (data, userId = null) => {
  validateBookingInput(data);

  const {
    outbound_flight_id, outbound_seat_class,
    return_flight_id, return_seat_class,
    trip_type = "one_way",
    adults = 1, children = 0, infants = 0,
    contact_name, contact_email, contact_phone,
    passengers,
  } = data;

  const a = parseInt(adults);
  const c = parseInt(children) || 0;
  const i = parseInt(infants) || 0;
  const seatsNeeded = a + c;

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const outboundSeat = await checkAndGetSeatInfo(
      client, outbound_flight_id, outbound_seat_class, seatsNeeded,
    );

    let returnSeat = null;
    if (trip_type === "round_trip" && return_flight_id) {
      returnSeat = await checkAndGetSeatInfo(
        client, return_flight_id, return_seat_class, seatsNeeded,
      );
    }

    const outboundTotal = calcTotalPrice(parseFloat(outboundSeat.base_price), a, c, i);
    const returnTotal   = returnSeat
      ? calcTotalPrice(parseFloat(returnSeat.base_price), a, c, i)
      : 0;

    let baggageTotal = 0;
    const outboundPassengers = passengers.filter(
      (p) => (p.flight_type || "outbound") === "outbound",
    );
    const returnPassengers = passengers.filter((p) => p.flight_type === "return");

    for (const p of outboundPassengers) {
      const extraKg = parseInt(p.extra_baggage_kg) || 0;
      if (extraKg > 0 && p.passenger_type !== "infant") {
        p._baggage_price = extraKg * parseFloat(outboundSeat.extra_baggage_price);
        baggageTotal += p._baggage_price;
      } else {
        p._baggage_price = 0;
      }
    }
    for (const p of returnPassengers) {
      const extraKg = parseInt(p.extra_baggage_kg) || 0;
      if (extraKg > 0 && returnSeat && p.passenger_type !== "infant") {
        p._baggage_price = extraKg * parseFloat(returnSeat.extra_baggage_price);
        baggageTotal += p._baggage_price;
      } else {
        p._baggage_price = 0;
      }
    }

    const totalPrice = outboundTotal + returnTotal + baggageTotal;
    const basePrice  = parseFloat(outboundSeat.base_price);

    let bookingCode;
    let isUnique = false;
    while (!isUnique) {
      bookingCode = generateBookingCode();
      const check = await client.query(
        "SELECT id FROM bookings WHERE booking_code=$1",
        [bookingCode],
      );
      if (check.rows.length === 0) isUnique = true;
    }

    const heldUntil = new Date(Date.now() + 30 * 60 * 1000);

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
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14,$15,$16)
      RETURNING *`,
      [
        bookingCode, userId,
        outbound_flight_id, outbound_seat_class,
        return_flight_id || null, return_seat_class || null,
        trip_type,
        a, c, i,
        basePrice, totalPrice,
        contact_name, contact_email, contact_phone || null,
        heldUntil,
      ],
    );

    const booking = bookingResult.rows[0];
    const assignedSeats = { outbound: [], return: [] };

    for (const p of passengers) {
      const flightType = p.flight_type || "outbound";
      const isInfant   = p.passenger_type === "infant";
      const extraKg    = parseInt(p.extra_baggage_kg) || 0;
      const seatInfo   = flightType === "outbound" ? outboundSeat : returnSeat;
      const defaultBaggageKg = seatInfo ? parseInt(seatInfo.baggage_included_kg) : 23;

      const passResult = await client.query(
        `INSERT INTO passengers (
          booking_id, flight_type, passenger_type,
          full_name, date_of_birth, gender,
          nationality, passport_number, passport_expiry,
          baggage_kg, extra_baggage_kg, baggage_price
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING id`,
        [
          booking.id, flightType, p.passenger_type,
          p.full_name, p.date_of_birth || null, p.gender || null,
          p.nationality || null, p.passport_number || null, p.passport_expiry || null,
          defaultBaggageKg, extraKg, p._baggage_price || 0,
        ],
      );

      const passengerId = passResult.rows[0].id;

      if (!isInfant) {
        const flightId  = flightType === "outbound" ? outbound_flight_id : return_flight_id;
        const seatClass = flightType === "outbound" ? outbound_seat_class : return_seat_class;
        const totalSeats = flightType === "outbound"
          ? parseInt(outboundSeat.total_seats)
          : parseInt(returnSeat?.total_seats || 0);

        if (flightId && seatClass && totalSeats > 0) {
          const seatNumber = await assignSeat(
            client, flightId, seatClass, totalSeats, passengerId, booking.id,
          );
          assignedSeats[flightType].push({ passenger: p.full_name, seat: seatNumber });
        }
      }
    }

    await client.query(
      `UPDATE flight_seats SET available_seats = available_seats - $1, updated_at = NOW()
       WHERE flight_id = $2 AND class = $3`,
      [seatsNeeded, outbound_flight_id, outbound_seat_class],
    );

    if (trip_type === "round_trip" && return_flight_id) {
      await client.query(
        `UPDATE flight_seats SET available_seats = available_seats - $1, updated_at = NOW()
         WHERE flight_id = $2 AND class = $3`,
        [seatsNeeded, return_flight_id, return_seat_class],
      );
    }

    await client.query("COMMIT");

    return {
      booking_code: booking.booking_code,
      booking_id:   booking.id,
      status:       booking.status,
      trip_type:    booking.trip_type,
      held_until:   booking.held_until,
      contact: {
        name:  booking.contact_name,
        email: booking.contact_email,
        phone: booking.contact_phone,
      },
      passengers: { adults: a, children: c, infants: i, total: a + c + i },
      seats_assigned: assignedSeats,
      baggage: {
        outbound_included_kg: parseInt(outboundSeat.baggage_included_kg),
        outbound_carry_on_kg: parseInt(outboundSeat.carry_on_kg),
        return_included_kg:   returnSeat ? parseInt(returnSeat.baggage_included_kg) : null,
        extra_baggage_total:  baggageTotal,
      },
      price: {
        base_price:     basePrice,
        outbound_total: outboundTotal,
        return_total:   returnTotal,
        baggage_total:  baggageTotal,
        total_price:    totalPrice,
      },
      message: `Đặt vé thành công! Vui lòng thanh toán trong 30 phút (trước ${heldUntil.toLocaleString("vi-VN")})`,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── getBookingDetail ─────────────────────────────────────────────────────────
// FIX: Thêm join payments để lấy final_amount thực tế sau khi áp coupon

const getBookingDetail = async (bookingCode, userId = null) => {
  const result = await pool.query(
    `SELECT b.*,
       f_out.flight_number   AS outbound_flight_number,
       f_out.departure_time  AS outbound_departure_time,
       f_out.arrival_time    AS outbound_arrival_time,
       f_out.duration_minutes AS outbound_duration,
       al_out.name           AS outbound_airline_name,
       al_out.code           AS outbound_airline_code,
       dep_out.code          AS outbound_dep_code, dep_out.city AS outbound_dep_city,
       arr_out.code          AS outbound_arr_code, arr_out.city AS outbound_arr_city,
       f_ret.flight_number   AS return_flight_number,
       f_ret.departure_time  AS return_departure_time,
       f_ret.arrival_time    AS return_arrival_time,
       f_ret.duration_minutes AS return_duration,
       al_ret.name           AS return_airline_name,
       al_ret.code           AS return_airline_code,
       dep_ret.code          AS return_dep_code, dep_ret.city AS return_dep_city,
       arr_ret.code          AS return_arr_code, arr_ret.city AS return_arr_city
     FROM bookings b
     JOIN flights  f_out   ON f_out.id  = b.outbound_flight_id
     JOIN airlines al_out  ON al_out.id = f_out.airline_id
     JOIN airports dep_out ON dep_out.id = f_out.departure_airport_id
     JOIN airports arr_out ON arr_out.id = f_out.arrival_airport_id
     LEFT JOIN flights  f_ret   ON f_ret.id  = b.return_flight_id
     LEFT JOIN airlines al_ret  ON al_ret.id = f_ret.airline_id
     LEFT JOIN airports dep_ret ON dep_ret.id = f_ret.departure_airport_id
     LEFT JOIN airports arr_ret ON arr_ret.id = f_ret.arrival_airport_id
     WHERE b.booking_code = $1`,
    [bookingCode],
  );

  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

  const b = result.rows[0];

  if (userId && b.user_id && b.user_id !== userId)
    throw new Error("Bạn không có quyền xem booking này");

  const passResult = await pool.query(
    `SELECT id, flight_type, passenger_type, full_name, date_of_birth, gender,
            nationality, passport_number, seat_number,
            baggage_kg, extra_baggage_kg, baggage_price
     FROM passengers WHERE booking_id = $1 ORDER BY flight_type, passenger_type`,
    [b.id],
  );

  // FIX: Lấy thông tin payment thực tế (final_amount, discount_amount)
  let paymentInfo = null;
  try {
    const payResult = await pool.query(
      `SELECT final_amount, discount_amount, status, payment_method
       FROM payments
       WHERE booking_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [b.id],
    );
    if (payResult.rows.length > 0) {
      paymentInfo = payResult.rows[0];
    }
  } catch (_) {
    // payments table may not exist yet — ignore
  }

  const totalPrice  = parseFloat(b.total_price);
  const finalAmount = paymentInfo ? parseFloat(paymentInfo.final_amount || totalPrice) : totalPrice;
  const discountAmt = paymentInfo ? parseFloat(paymentInfo.discount_amount || 0) : 0;

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
      flight_number:    b.outbound_flight_number,
      seat_class:       b.outbound_seat_class,
      airline:  { code: b.outbound_airline_code, name: b.outbound_airline_name },
      departure: { code: b.outbound_dep_code, city: b.outbound_dep_city, time: b.outbound_departure_time },
      arrival:   { code: b.outbound_arr_code, city: b.outbound_arr_city, time: b.outbound_arrival_time },
      duration_minutes: b.outbound_duration,
    },
    return_flight: b.return_flight_id
      ? {
          flight_number:    b.return_flight_number,
          seat_class:       b.return_seat_class,
          airline:  { code: b.return_airline_code, name: b.return_airline_name },
          departure: { code: b.return_dep_code, city: b.return_dep_city, time: b.return_departure_time },
          arrival:   { code: b.return_arr_code, city: b.return_arr_city, time: b.return_arrival_time },
          duration_minutes: b.return_duration,
        }
      : null,
    passengers: {
      adults:   b.total_adults,
      children: b.total_children,
      infants:  b.total_infants,
      list:     passResult.rows,
    },
    // FIX: trả đủ final_amount cho frontend hiển thị giá sau discount
    price: {
      base_price:      parseFloat(b.base_price),
      total_price:     totalPrice,
      final_amount:    finalAmount,
      discount_amount: discountAmt,
    },
  };
};

// ─── getMyBookings ────────────────────────────────────────────────────────────
// FIX: Logic filter sai — pending phải ở "upcoming", confirmed phải ở "completed"

const getMyBookings = async (userId, filter = "all") => {
  const validFilters = ["all", "upcoming", "completed", "cancelled", "expired"];
  if (!validFilters.includes(filter)) throw new Error("filter không hợp lệ");

  let filterCondition = "";

  if (filter === "upcoming") {
    // FIX: upcoming = pending (đã đặt, chưa thanh toán)
    filterCondition = `AND b.status = 'pending'`;
  }

  if (filter === "completed") {
    // FIX: completed = confirmed (đã thanh toán xong)
    filterCondition = `AND b.status = 'confirmed'`;
  }

  if (filter === "cancelled") {
    filterCondition = `AND b.status IN ('cancelled', 'expired')`;
  }

  if (filter === "expired") {
    filterCondition = `AND b.status = 'expired'`;
  }

  const result = await pool.query(
    `
    SELECT
      b.id,
      b.booking_code,
      b.status,
      b.trip_type,
      b.total_adults,
      b.total_children,
      b.total_infants,
      b.total_price,
      b.created_at,

      f.id AS flight_id,
      f.flight_number,
      f.departure_time,
      f.arrival_time,

      dep.code AS dep_code,
      dep.city AS dep_city,
      arr.code AS arr_code,
      arr.city AS arr_city,

      al.name AS airline_name,
      al.code AS airline_code,

      COUNT(p.id) AS passenger_count,

      -- FIX: history_type dựa vào payment status thay vì thời gian bay, trạng thái booking
      CASE
        WHEN b.status = 'cancelled' THEN 'cancelled'
        WHEN b.status = 'expired'   THEN 'expired'
        WHEN b.status = 'pending'   THEN 'upcoming'
        WHEN b.status = 'confirmed' THEN 'completed'
        ELSE 'upcoming'
      END AS history_type,

      -- Lấy final_amount từ payments nếu có
      (
        SELECT final_amount FROM payments
        WHERE booking_id = b.id
        ORDER BY created_at DESC LIMIT 1
      ) AS final_amount

    FROM bookings b
    JOIN flights  f   ON f.id  = b.outbound_flight_id
    JOIN airports dep ON dep.id = f.departure_airport_id
    JOIN airports arr ON arr.id = f.arrival_airport_id
    JOIN airlines al  ON al.id  = f.airline_id
    LEFT JOIN passengers p ON p.booking_id = b.id

    WHERE b.user_id = $1
    ${filterCondition}

    GROUP BY b.id, f.id, dep.id, arr.id, al.id

    ORDER BY b.created_at DESC
    `,
    [userId],
  );

  return result.rows.map((row) => ({
    booking_id:   row.id,
    booking_code: row.booking_code,
    status:       row.status,
    history_type: row.history_type,
    trip_type:    row.trip_type,
    passengers: {
      total:    parseInt(row.passenger_count),
      adults:   row.total_adults,
      children: row.total_children,
      infants:  row.total_infants,
    },
    total_price:  parseFloat(row.total_price),
    final_amount: row.final_amount ? parseFloat(row.final_amount) : parseFloat(row.total_price),
    created_at:   row.created_at,
    flight: {
      flight_id:     row.flight_id,
      flight_number: row.flight_number,
      airline: { code: row.airline_code, name: row.airline_name },
      departure: { code: row.dep_code, city: row.dep_city, time: row.departure_time },
      arrival:   { code: row.arr_code, city: row.arr_city, time: row.arrival_time },
    },
  }));
};

// ─── cancelBooking ────────────────────────────────────────────────────────────

const cancelBooking = async (userId, bookingCode) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const bookingResult = await client.query(
      `SELECT b.id, b.booking_code, b.user_id,
              b.outbound_flight_id, b.return_flight_id,
              b.outbound_seat_class, b.return_seat_class,
              b.trip_type, b.total_price, b.status, b.created_at, b.updated_at,
              f.departure_time
       FROM bookings b
       JOIN flights f ON f.id = b.outbound_flight_id
       WHERE b.booking_code = $1
       LIMIT 1`,
      [bookingCode],
    );

    if (bookingResult.rows.length === 0) throw new Error("Không tìm thấy booking");

    const booking = bookingResult.rows[0];

    if (booking.user_id !== userId)    throw new Error("Bạn không có quyền hủy booking này");
    if (booking.status === "cancelled") throw new Error("Booking này đã bị hủy rồi");
    if (booking.status === "expired")   throw new Error("Booking này đã hết hạn");

    const departureTime = new Date(booking.departure_time);
    const now           = new Date();
    if (departureTime <= now) throw new Error("Không thể hủy vì chuyến bay đã khởi hành");

    const diffHours = (departureTime - now) / (1000 * 60 * 60);
    const refundPercent = diffHours > 24 ? 100 : diffHours >= 6 ? 50 : 0;

    let payment = null;
    try {
      const paymentResult = await client.query(
        `SELECT id, amount, discount_amount, final_amount, status, payment_method, paid_at, created_at
         FROM payments WHERE booking_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [booking.id],
      );
      payment = paymentResult.rows[0] || null;
    } catch (_) {}

    const paidAmount   = payment ? parseFloat(payment.final_amount || 0) : 0;
    const refundAmount = (paidAmount * refundPercent) / 100;

    await client.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [booking.id],
    );

    await rollbackReservedVoucherUsageForBooking(client, booking.id);

    const ticketUpdateResult = await client.query(
      `UPDATE tickets SET status = 'cancelled' WHERE booking_id = $1 RETURNING id`,
      [booking.id],
    );

    const seatAssignmentsResult = await client.query(
      `SELECT id, flight_id, class FROM flight_seat_assignments WHERE booking_id = $1`,
      [booking.id],
    );
    const seatAssignments = seatAssignmentsResult.rows;

    if (seatAssignments.length > 0) {
      await client.query(
        `UPDATE flight_seat_assignments
         SET status = 'available', passenger_id = NULL, booking_id = NULL
         WHERE booking_id = $1`,
        [booking.id],
      );

      const groupedSeats = {};
      for (const row of seatAssignments) {
        const key = `${row.flight_id}__${row.class}`;
        groupedSeats[key] = (groupedSeats[key] || 0) + 1;
      }
      for (const key of Object.keys(groupedSeats)) {
        const [flightId, seatClass] = key.split("__");
        // Nâng lại số ghế trống
        await client.query(
          `UPDATE flight_seats SET available_seats = available_seats + $1, updated_at = NOW()
           WHERE flight_id = $2 AND class = $3`,
          [groupedSeats[key], flightId, seatClass],
        );
      }
    }

    let paymentStatusAfterCancel = null;
    if (payment) {
      try {
        if (payment.status === "success") {
          paymentStatusAfterCancel = refundAmount === 0
            ? "cancelled"
            : refundAmount < paidAmount ? "partial_refund_pending" : "refund_pending";
        } else {
          paymentStatusAfterCancel = "cancelled";
        }
        await client.query(
          `UPDATE payments SET status = $1, cancelled_at = NOW(), updated_at = NOW() WHERE id = $2`,
          [paymentStatusAfterCancel, payment.id],
        );
      } catch (_) {}
    }

    await client.query("COMMIT");

    return {
      booking_id:     booking.id,
      booking_code:   booking.booking_code,
      booking_status: "cancelled",
      cancelled_at:   new Date().toISOString(),
      policy:         { hours_before_departure: Number(diffHours.toFixed(2)), refund_percent: refundPercent },
      payment: payment
        ? { payment_id: payment.id, old_status: payment.status, new_status: paymentStatusAfterCancel, paid_amount: paidAmount, refund_amount: refundAmount }
        : null,
      released_seats:    seatAssignments.length,
      cancelled_tickets: ticketUpdateResult.rows.length,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// ─── expireHeldBookings ───────────────────────────────────────────────────────

const expireHeldBookings = async () => {
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");

    const expired = await client.query(
      `SELECT * FROM bookings WHERE status='pending' AND held_until < NOW() FOR UPDATE SKIP LOCKED`,
    );
    for (const booking of expired.rows) {
      const seatsNeeded = booking.total_adults + booking.total_children;

      await client.query(
        `UPDATE flight_seats SET available_seats = available_seats + $1, updated_at = NOW()
         WHERE flight_id = $2 AND class = $3`,
        [seatsNeeded, booking.outbound_flight_id, booking.outbound_seat_class],
      );

      if (booking.return_flight_id) {
        await client.query(
          `UPDATE flight_seats SET available_seats = available_seats + $1, updated_at = NOW()
           WHERE flight_id = $2 AND class = $3`,
          [seatsNeeded, booking.return_flight_id, booking.return_seat_class],
        );
      }
      await client.query(
        `UPDATE flight_seat_assignments SET status='available', passenger_id=NULL, booking_id=NULL
         WHERE booking_id=$1`,
        [booking.id],
      );
      await rollbackReservedVoucherUsageForBooking(client, booking.id);
      await client.query(
        `UPDATE payments
         SET status='EXPIRED', expired_at=NOW(), updated_at=NOW()
         WHERE booking_id=$1 AND status='PENDING'`,
        [booking.id],
      );
      await client.query(
        "UPDATE bookings SET status='expired', updated_at=NOW() WHERE id=$1",
        [booking.id],
      );
    }
    await client.query("COMMIT");
    if (expired.rows.length > 0)
      console.log(`[Auto-expire] Đã hủy ${expired.rows.length} booking hết hạn`);
  } catch (err) {
    if (client) {
      try {
        await client.query("ROLLBACK");
      } catch (_) {}
    }
    console.error("[Auto-expire] Lỗi:", err.message);
  } finally {
    if (client) {
      client.release();
    }
  }
};

module.exports = {
  createBooking,
  getBookingDetail,
  getMyBookings,
  cancelBooking,
  expireHeldBookings,
};
