const pool = require("../config/db");
const { assignSeat } = require("../utils/seat");
const { rollbackReservedVoucherUsageForBooking } = require("./payment.service");
const QB = require("../queries/booking.queries");
const QF = require("../queries/flight.queries");
const QP = require("../queries/payment.queries");
const QAnc = require("../queries/ancillary.queries");
const QB2 = { SELECT_MY_BOOKINGS: QB.SELECT_MY_BOOKINGS };

// ====================== THÊM LOYALTY SERVICE ======================
const loyaltyService = require('../services/loyalty.service');
// =================================================================

const generateBookingCode = () => {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits  = "0123456789";
  let code = "";
  for (let i = 0; i < 2; i++) code += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 6; i++) code += digits[Math.floor(Math.random() * digits.length)];
  return code;
};

const calcTotalPrice = (basePrice, adults, children, infants) => {
  const adultTotal  = basePrice * adults;
  const childTotal  = basePrice * 0.75 * children;
  const infantTotal = basePrice * 0.1 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
};

const { applyDynamicPricing: applyDemand } = require('../utils/pricing');

const validateBookingInput = (data) => {
  // ... (giữ nguyên code validate của bạn)
  const {
    outbound_flight_id, outbound_seat_class,
    return_flight_id, return_seat_class,
    trip_type, adults, children, infants,
    contact_name, contact_email, passengers,
  } = data;

  if (!outbound_flight_id)  throw new Error("outbound_flight_id là bắt buộc");
  if (!outbound_seat_class) throw new Error("outbound_seat_class là bắt buộc");
  if (!contact_name)        throw new Error("contact_name là bắt buộc");
  if (!contact_email)       throw new Error("contact_email là bắt buộc");

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(contact_email)) throw new Error("contact_email không hợp lệ");

  const validClasses = ["economy", "business", "first"];
  if (!validClasses.includes(outbound_seat_class)) throw new Error("outbound_seat_class phải là economy, business hoặc first");

  if (trip_type === "round_trip") {
    if (!return_flight_id)  throw new Error("return_flight_id là bắt buộc cho khứ hồi");
    if (!return_seat_class) throw new Error("return_seat_class là bắt buộc cho khứ hồi");
    if (!validClasses.includes(return_seat_class)) throw new Error("return_seat_class phải là economy, business hoặc first");
  }

  const a = parseInt(adults) || 1;
  const c = parseInt(children) || 0;
  const i = parseInt(infants) || 0;

  if (a < 1)     throw new Error("Phải có ít nhất 1 người lớn");
  if (c < 0)     throw new Error("Số trẻ em không hợp lệ");
  if (i < 0)     throw new Error("Số em bé không hợp lệ");
  if (a + c > 9) throw new Error("Tổng số hành khách không được quá 9");
  if (i > a)     throw new Error("Số em bé không được nhiều hơn số người lớn");

  if (!passengers || !Array.isArray(passengers) || passengers.length === 0) throw new Error("Danh sách hành khách là bắt buộc");

  const expectedCount  = a + c + i;
  const tripMultiplier = trip_type === "round_trip" ? 2 : 1;
  if (passengers.length !== expectedCount * tripMultiplier) {
    throw new Error(`Số lượng hành khách không khớp. Cần ${expectedCount * tripMultiplier}, nhận ${passengers.length}`);
  }

  for (const p of passengers) {
    if (!p.full_name)      throw new Error("full_name là bắt buộc cho mỗi hành khách");
    if (!p.passenger_type) throw new Error("passenger_type là bắt buộc cho mỗi hành khách");
    if (!["adult", "child", "infant"].includes(p.passenger_type)) throw new Error("passenger_type phải là adult, child hoặc infant");
    if (!["outbound", "return"].includes(p.flight_type || "outbound")) throw new Error("flight_type phải là outbound hoặc return");
    if (p.extra_baggage_kg !== undefined && parseInt(p.extra_baggage_kg) < 0) throw new Error("extra_baggage_kg không hợp lệ");
  }
};

const checkAndGetSeatInfo = async (client, flightId, seatClass, seatsNeeded) => {
  // ... (giữ nguyên code của bạn)
  const result = await client.query(QF.SELECT_SEAT_INFO, [flightId, seatClass]);

  if (result.rows.length === 0) throw new Error(`Không tìm thấy hạng ghế ${seatClass} cho chuyến bay ID ${flightId}`);

  const seat = result.rows[0];
  if (seat.status !== "scheduled") throw new Error(`Chuyến bay ID ${flightId} không còn khả dụng (status: ${seat.status})`);
  if (new Date(seat.departure_time) <= new Date()) throw new Error(`Chuyến bay ID ${flightId} đã khởi hành`);
  if (seat.available_seats < seatsNeeded) {
    throw new Error(`Chuyến bay ID ${flightId} hạng ${seatClass} không đủ ghế. Còn ${seat.available_seats}, cần ${seatsNeeded}`);
  }

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

    if (userId) {
      // Đã đăng nhập: email/phone phải khớp với tài khoản đang dùng
      const userRow = await client.query(`SELECT email, phone FROM users WHERE id = $1`, [userId]);
      const u = userRow.rows[0];
      if (u && u.email && contact_email.toLowerCase() !== u.email.toLowerCase()) {
        throw new Error('Email liên hệ phải là email tài khoản của bạn.');
      }
      if (u && u.phone && contact_phone && contact_phone.replace(/\s/g,'') !== u.phone) {
        throw new Error('Số điện thoại liên hệ phải là số điện thoại tài khoản của bạn.');
      }
    } else {
      // Guest: kiểm tra không dùng email/phone đã thuộc tài khoản khác
      const emailCheck = await client.query(
        `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [contact_email]
      );
      if (emailCheck.rows.length > 0) {
        throw new Error('Email này đã được đăng ký. Vui lòng đăng nhập hoặc dùng email khác.');
      }
      if (contact_phone) {
        const phoneCheck = await client.query(
          `SELECT id FROM users WHERE phone = $1`, [contact_phone.replace(/\s/g,'')]
        );
        if (phoneCheck.rows.length > 0) {
          throw new Error('Số điện thoại này đã được đăng ký. Vui lòng đăng nhập hoặc dùng số khác.');
        }
      }
    }

    const outboundSeat = await checkAndGetSeatInfo(client, outbound_flight_id, outbound_seat_class, seatsNeeded);

    let returnSeat = null;
    if (trip_type === "round_trip" && return_flight_id) {
      returnSeat = await checkAndGetSeatInfo(client, return_flight_id, return_seat_class, seatsNeeded);
    }

    const outboundPrice = applyDemand(parseFloat(outboundSeat.base_price), outboundSeat.available_seats, outboundSeat.total_seats, outboundSeat.departure_time);
    const returnPrice   = returnSeat ? applyDemand(parseFloat(returnSeat.base_price), returnSeat.available_seats, returnSeat.total_seats, returnSeat.departure_time) : 0;

    const outboundTotal = calcTotalPrice(outboundPrice, a, c, i);
    const returnTotal   = returnSeat ? calcTotalPrice(returnPrice, a, c, i) : 0;

    let baggageTotal = 0;
    const outboundPassengers = passengers.filter((p) => (p.flight_type || "outbound") === "outbound");
    const returnPassengers   = passengers.filter((p) => p.flight_type === "return");

    for (const p of outboundPassengers) {
      const extraKg = parseInt(p.extra_baggage_kg) || 0;
      p._baggage_price = (extraKg > 0 && p.passenger_type !== "infant")
        ? extraKg * parseFloat(outboundSeat.extra_baggage_price)
        : 0;
      baggageTotal += p._baggage_price;
    }
    for (const p of returnPassengers) {
      const extraKg = parseInt(p.extra_baggage_kg) || 0;
      p._baggage_price = (extraKg > 0 && returnSeat && p.passenger_type !== "infant")
        ? extraKg * parseFloat(returnSeat.extra_baggage_price)
        : 0;
      baggageTotal += p._baggage_price;
    }

    const seatExtraFee = parseFloat(data.seat_extra_fee) || 0;
    const ancillaryFee = (data.ancillary_options || []).reduce(
      (sum, opt) => sum + (Number(opt.unit_price || 0) * Number(opt.quantity || 1)), 0
    );
    // Lưu 1 giá duy nhất: tất cả gộp vào total_price
    const totalPrice   = outboundTotal + returnTotal + baggageTotal + seatExtraFee + ancillaryFee;
    const basePrice    = outboundPrice;

    let bookingCode;
    let isUnique = false;
    while (!isUnique) {
      bookingCode = generateBookingCode();
      const check = await client.query(QB.CHECK_BOOKING_CODE_EXISTS, [bookingCode]);
      if (check.rows.length === 0) isUnique = true;
    }

    const heldUntil = new Date(Date.now() + 30 * 60 * 1000);

    const bookingResult = await client.query(QB.INSERT_BOOKING, [
      bookingCode, userId,
      outbound_flight_id, outbound_seat_class,
      return_flight_id || null, return_seat_class || null,
      trip_type,
      a, c, i,
      basePrice, totalPrice,
      contact_name, contact_email, contact_phone || null,
      heldUntil,
    ]);

    const booking = bookingResult.rows[0];
    const assignedSeats = { outbound: [], return: [] };

    // ... (toàn bộ phần insert passenger, assign seat, decrease seats giữ nguyên)

    let firstOutboundPassengerId = null;

    for (const p of passengers) {
      const flightType       = p.flight_type || "outbound";
      const isInfant         = p.passenger_type === "infant";
      const extraKg          = parseInt(p.extra_baggage_kg) || 0;
      const seatInfo         = flightType === "outbound" ? outboundSeat : returnSeat;
      const defaultBaggageKg = seatInfo ? parseInt(seatInfo.baggage_included_kg) : 23;

      const passResult = await client.query(QB.INSERT_PASSENGER, [
        booking.id, flightType, p.passenger_type,
        p.full_name, p.date_of_birth || null, p.gender || null,
        p.nationality || null, p.passport_number || null, p.passport_expiry || null,
        defaultBaggageKg, extraKg, p._baggage_price || 0,
      ]);

      const passengerId = passResult.rows[0].id;

      if (flightType === 'outbound' && !firstOutboundPassengerId) {
        firstOutboundPassengerId = passengerId;
      }

      if (!isInfant) {
        const flightId   = flightType === "outbound" ? outbound_flight_id : return_flight_id;
        const seatClass  = flightType === "outbound" ? outbound_seat_class : return_seat_class;
        const totalSeats = flightType === "outbound"
          ? parseInt(outboundSeat.total_seats)
          : parseInt(returnSeat?.total_seats || 0);

        if (flightId && seatClass && totalSeats > 0) {
          const seatNumber = await assignSeat(client, flightId, seatClass, totalSeats, passengerId, booking.id, p.seat_number || null);
          assignedSeats[flightType].push({ passenger: p.full_name, seat: seatNumber });
        }
      }
    }

    await client.query(QF.DECREASE_AVAILABLE_SEATS, [seatsNeeded, outbound_flight_id, outbound_seat_class]);

    if (trip_type === "round_trip" && return_flight_id) {
      await client.query(QF.DECREASE_AVAILABLE_SEATS, [seatsNeeded, return_flight_id, return_seat_class]);
    }

    // Lưu ancillary_options vào booking_ancillaries
    const ancillaryOptions = data.ancillary_options || [];
    if (ancillaryOptions.length > 0 && firstOutboundPassengerId) {
      for (const opt of ancillaryOptions) {
        const qty       = parseInt(opt.quantity) || 1;
        const unitPrice = Number(opt.unit_price) || 0;
        await client.query(QAnc.INSERT_ANCILLARY, [
          booking.id, firstOutboundPassengerId, opt.ancillary_option_id,
          'outbound', qty, unitPrice, unitPrice * qty,
        ]);
      }
    }

        // ====================== HOOK LOYALTY - DEBUG (tạm thời) ======================
    if (userId) {
      console.log(`[DEBUG Loyalty] Bắt đầu tích điểm → userId=${userId}, bookingId=${booking.id}, totalPrice=${totalPrice}`);
      
      try {
        const result = await loyaltyService.earnPointsAfterBooking(userId, booking.id, totalPrice);
        console.log(`[DEBUG Loyalty] TÍCH ĐIỂM THÀNH CÔNG → pointsEarned = ${result.pointsEarned}`);
      } catch (loyaltyErr) {
        console.error(`[DEBUG Loyalty] LỖI khi tích điểm:`, loyaltyErr.message);
      }
    } else {
      console.log(`[DEBUG Loyalty] BỎ QUA vì userId = null (người dùng chưa đăng nhập)`);
    }
    
    // ==============================================================================================

    await client.query("COMMIT");

    return {
      booking_code: booking.booking_code,
      booking_id:   booking.id,
      status:       booking.status,
      trip_type:    booking.trip_type,
      held_until:   booking.held_until,
      contact: { name: booking.contact_name, email: booking.contact_email, phone: booking.contact_phone },
      passengers:     { adults: a, children: c, infants: i, total: a + c + i },
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

// Các hàm còn lại giữ nguyên (getBookingDetail, getMyBookings, cancelBooking, expireHeldBookings)
const getBookingDetail = async (bookingCode, userId = null) => {
  const result = await pool.query(QB.SELECT_BOOKING_DETAIL, [bookingCode]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");

  const b = result.rows[0];
  if (userId && b.user_id && b.user_id !== userId) throw new Error("Bạn không có quyền xem booking này");

  const passResult = await pool.query(QB.SELECT_PASSENGERS_BY_BOOKING, [b.id]);

  let paymentInfo = null;
  let ancillaryTotal = 0;
  try {
    const [payResult, ancResult] = await Promise.all([
      pool.query(QB.SELECT_BOOKING_PAYMENT_INFO, [b.id]),
      pool.query(QAnc.GET_ANCILLARY_TOTAL, [b.id]),
    ]);
    if (payResult.rows.length > 0) paymentInfo = payResult.rows[0];
    ancillaryTotal = parseFloat(ancResult.rows[0]?.ancillary_total || 0);
  } catch (_) {}

  const totalPrice  = parseFloat(b.total_price);
  const basePrice   = parseFloat(b.base_price);
  const baggageTotal = Math.max(totalPrice - basePrice, 0);
  const finalAmount = paymentInfo ? parseFloat(paymentInfo.final_amount || totalPrice) : totalPrice;
  const discountAmt = paymentInfo ? parseFloat(paymentInfo.discount_amount || 0) : 0;
  const grandTotal  = totalPrice + ancillaryTotal;

  return {
    booking_code: b.booking_code,
    booking_id:   b.id,
    status:       b.status,
    trip_type:    b.trip_type,
    held_until:   b.held_until,
    created_at:   b.created_at,
    contact: { name: b.contact_name, email: b.contact_email, phone: b.contact_phone },
    outbound_flight: {
      flight_id:        b.outbound_flight_id,
      flight_number:    b.outbound_flight_number,
      seat_class:       b.outbound_seat_class,
      airline:   { code: b.outbound_airline_code, name: b.outbound_airline_name, logo_url: b.outbound_airline_logo, logo_dark: b.outbound_airline_logo_dark, logo_light: b.outbound_airline_logo_light },
      departure: { code: b.outbound_dep_code, city: b.outbound_dep_city, time: b.outbound_departure_time },
      arrival:   { code: b.outbound_arr_code, city: b.outbound_arr_city, time: b.outbound_arrival_time },
      duration_minutes: b.outbound_duration,
    },
    return_flight: b.return_flight_id
      ? {
          flight_id:        b.return_flight_id,
          flight_number:    b.return_flight_number,
          seat_class:       b.return_seat_class,
          airline:   { code: b.return_airline_code, name: b.return_airline_name, logo_url: b.return_airline_logo, logo_dark: b.return_airline_logo_dark, logo_light: b.return_airline_logo_light },
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
    baggage: {
      extra_baggage_total: baggageTotal,
    },
    price: {
      base_price:      basePrice,
      total_price:     totalPrice,
      baggage_total:   baggageTotal,
      ancillary_total: ancillaryTotal,
      grand_total:     grandTotal,
      final_amount:    finalAmount,
      discount_amount: discountAmt,
    },
  };
};

// ─── getMyBookings ────────────────────────────────────────────────────────────

const getMyBookings = async (userId, filter = "all", from_date, to_date) => {
  const conditions = [];
  const values = [];
  let idx = 1;

  conditions.push(`b.user_id = $${idx++}`);
  values.push(userId);

  if (filter === "upcoming") {
    conditions.push(`b.status IN ('confirmed', 'pending')`);
    conditions.push(`f.departure_time > NOW()`);
  } else if (filter === "completed") {
    conditions.push(`b.status = 'confirmed'`);
    conditions.push(`f.departure_time <= NOW()`);
  } else if (filter === "cancelled") {
    conditions.push(`b.status IN ('cancelled', 'refunded')`);
  }

  if (from_date) {
    conditions.push(`DATE(b.created_at) >= $${idx++}`);
    values.push(from_date);
  }
  if (to_date) {
    conditions.push(`DATE(b.created_at) <= $${idx++}`);
    values.push(to_date);
  }

  const dk = `WHERE ${conditions.join(' AND ')}`;
  const query = QB2.SELECT_MY_BOOKINGS(dk);
  
  const result = await pool.query(query, values);
  return result.rows;
};

const cancelBooking = async (userId, bookingCode, reason = null) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get booking
    const bookingResult = await client.query(QB.SELECT_BOOKING_DETAIL, [bookingCode]);
    if (bookingResult.rows.length === 0) throw new Error('Không tìm thấy booking');

    const booking = bookingResult.rows[0];

    // 2. Check ownership
    if (userId && booking.user_id && booking.user_id !== userId) {
      throw new Error('Bạn không có quyền hủy booking này');
    }

    // 3. Check payment exists
    const paymentResult = await client.query(QP.SELECT_PAYMENT_BY_BOOKING, [booking.id]);
    const payment = paymentResult.rows[0];

    // 4. Determine cancel flow based on status and payment
    if (booking.status === 'pending' || booking.status === 'expired') {
      // CHƯA THANH TOÁN: Hủy trực tiếp (giải phóng ghế)
      if (booking.status === 'pending') {
        // Release seats
        const seatsNeeded = parseInt(booking.total_adults) + parseInt(booking.total_children);
        await client.query(
          `UPDATE flight_seats SET available_seats = available_seats + $1, updated_at = NOW()
           WHERE flight_id = $2 AND seat_class = $3`,
          [seatsNeeded, booking.outbound_flight_id, booking.outbound_seat_class]
        );

        if (booking.trip_type === 'round_trip' && booking.return_flight_id) {
          await client.query(
            `UPDATE flight_seats SET available_seats = available_seats + $1, updated_at = NOW()
             WHERE flight_id = $2 AND seat_class = $3`,
            [seatsNeeded, booking.return_flight_id, booking.return_seat_class]
          );
        }
      }

      // Update booking status
      await client.query(QB.UPDATE_BOOKING_STATUS, ['cancelled', booking.id]);

      await client.query('COMMIT');

      return {
        success: true,
        booking_code: bookingCode,
        status: 'cancelled',
        refund_status: 'no_refund',
        message: 'Booking đã được hủy thành công (không hoàn tiền vì chưa thanh toán)',
      };
    } else if (booking.status === 'confirmed' && payment && payment.status === 'SUCCESS') {
      // ĐÃ THANH TOÁN: Redirect to refund flow
      await client.query('ROLLBACK'); // Release client

      // Import and call refund service
      const refundService = require('./refund.service');
      return await refundService.cancelWithRefund(userId, bookingCode, reason || 'Yêu cầu hủy booking');
    } else {
      // Các trạng thái khác không cho hủy
      throw new Error(`Không thể hủy booking có trạng thái "${booking.status}"`);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

const expireHeldBookings = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Tìm booking pending đã hết thời gian giữ ghế
    const expired = await client.query(
      `SELECT * FROM bookings
       WHERE status = 'pending'
         AND held_until < NOW()
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

      // Hoàn ghế chuyến về (nếu khứ hồi)
      if (booking.return_flight_id) {
        await client.query(
          `UPDATE flight_seats
           SET available_seats = available_seats + $1, updated_at = NOW()
           WHERE flight_id = $2 AND class = $3`,
          [seatsNeeded, booking.return_flight_id, booking.return_seat_class]
        );
      }

      // Đánh dấu booking là expired
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


/**
 * CẤP 2 — Auto-complete chuyến bay đã bay + hủy booking của chuyến cancelled
 * Chạy mỗi phút qua cron trong app.js
 */
const autoCompleteFlights = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Chuyển tất cả chuyến bay đã khởi hành sang "completed"
    const completedResult = await client.query(`
      UPDATE flights
      SET    status     = 'completed',
             updated_at = NOW()
      WHERE  departure_time < NOW()
        AND  (departure_time + (duration_minutes * 0.3 * INTERVAL '1 minute')) < NOW()
        AND  status NOT IN ('cancelled', 'completed')
      RETURNING id, flight_number
    `);
      // chỉ check chuyến bay //////// WARNING:
    if (completedResult.rows.length > 0) {
      console.log(
        `[AutoComplete] Đã hoàn thành ${completedResult.rows.length} chuyến bay:`,
        completedResult.rows.map(r => r.flight_number).join(", ")
      );

      // 2. Tự động expire các booking "pending" của chuyến đã completed
      //    (user giữ ghế nhưng chưa thanh toán, chuyến đã bay → hủy luôn)
      for (const flight of completedResult.rows) {
        const expiredBookings = await client.query(`
          SELECT id, total_adults, total_children,
                 outbound_flight_id, outbound_seat_class,
                 return_flight_id,   return_seat_class
          FROM bookings
          WHERE (outbound_flight_id = $1 OR return_flight_id = $1)
            AND status = 'pending'
        `, [flight.id]);

        for (const booking of expiredBookings.rows) {
          const seats = booking.total_adults + booking.total_children;

          // Hoàn ghế chuyến đi
          await client.query(`
            UPDATE flight_seats
            SET available_seats = available_seats + $1, updated_at = NOW()
            WHERE flight_id = $2 AND class = $3
          `, [seats, booking.outbound_flight_id, booking.outbound_seat_class]);

          // Hoàn ghế chuyến về (nếu có)
          if (booking.return_flight_id) {
            await client.query(`
              UPDATE flight_seats
              SET available_seats = available_seats + $1, updated_at = NOW()
              WHERE flight_id = $2 AND class = $3
            `, [seats, booking.return_flight_id, booking.return_seat_class]);
          }

          // Đánh dấu booking là expired
          await client.query(`
            UPDATE bookings SET status = 'expired', updated_at = NOW() WHERE id = $1
          `, [booking.id]);
        }

        if (expiredBookings.rows.length > 0) {
          console.log(`[AutoComplete] Đã expire ${expiredBookings.rows.length} booking pending của chuyến ${flight.flight_number}`);
        }
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[AutoComplete] Lỗi:", err.message);
  } finally {
    client.release();
  }
};

module.exports = { createBooking, getBookingDetail, getMyBookings, cancelBooking, expireHeldBookings, autoCompleteFlights };