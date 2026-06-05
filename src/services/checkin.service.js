'use strict';

/*
============================================================
CHECKIN SERVICE - Check-in online
============================================================

Quy trình:
1. Validate booking (tồn tại, chưa check-in, trong thời gian)
2. Generate boarding pass cho mỗi passenger
3. Trả về boarding pass info

Config:
- Cho phép check-in trước 24h
- Không cho check-in sau 30 phút trước giờ bay
============================================================
*/

const db = require('../config/db');
const SQ = require('../queries/seat.queries');

// Config

const CHECKIN_CONFIG = {
  // Cho phep check-in truoc bao nhieu gio
  minHoursBefore: 24,
  // Khong cho check-in sau bao nhieu phut
  maxMinutesBefore: 30,
  // Gate mac dinh neu chua co
  defaultGate: 'TBA',
};

// Helpers

// Tạo mã boarding pass: {BOOKING_CODE}-{PASSENGER_INDEX}
const generateBoardingPassCode = (bookingCode, passengerIndex) => {
  return `${bookingCode}-P${passengerIndex}`;
};

// Lấy số sequence tiếp theo
const getNextSequenceNumber = async (bookingId, flightType) => {
  const pool = db;
  const result = await pool.query(SQ.GET_NEXT_SEQUENCE_NUMBER, [bookingId, flightType]);
  return result.rows[0]?.next_seq || 1;
};

// Format ngày cho boarding pass
const formatDate = (dateString) => {
  const date = new Date(dateString);
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  return date.toLocaleDateString('en-GB', options).toUpperCase();
};

// Format giờ cho boarding pass
const formatTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

// Tính số phút boarding trước giờ bay
// ≤ 2h → 45 phút | 2-5h → 60 phút | > 5h → 90 phút
const getBoardingMinutes = (depTime, arrTime) => {
  if (!depTime || !arrTime) return 45;
  const durationMins = (new Date(arrTime) - new Date(depTime)) / 60000;
  if (durationMins <= 120) return 45;
  if (durationMins <= 300) return 60;
  return 90;
};

// Tạo gate tự động theo sân bay
// Vietnam → số thường
// Quốc tế → chữ + số (theo hub)
// Vietnam → chỉ số (tự động đúng với mọi sân bay VN mới thêm vào)
// Quốc tế → chữ + số (theo chuẩn phổ biến của hub đó)
// Hash từ flight_number → cùng chuyến luôn ra cùng gate
const generateGate = (flightNumber, departureAirport, departureCountry) => {
  const fn      = (flightNumber     || '').toUpperCase();
  const dep     = (departureAirport || '').toUpperCase();
  const country = (departureCountry || '').toLowerCase();

  const h    = fn.split('').reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) & 0xfffffff, 0);
  const pick = (max) => (h % max) + 1;

  // ── Sân bay Việt Nam: gate chỉ là số ─────────────────────
  // Tự động áp dụng cho mọi sân bay có country = 'Vietnam'
  if (country.includes('viet') || country === 'vn') {
    if (dep === 'SGN') return String(pick(20));
    if (dep === 'HAN') return String(pick(30));
    if (dep === 'DAD') return String(pick(10));
    return String(pick(8)); // sân bay VN khác mặc định 1-8
  }

  // ── Sân bay quốc tế: chữ + số theo hub ──────────────────
  if (dep === 'BKK') return 'ABCDE'[h % 5] + pick(10);
  if (dep === 'SIN') { const p = 'ABCD'[h % 4]; return p + pick(p === 'D' ? 10 : 30); }
  if (dep === 'KUL') { const p = 'CD'[h % 2];   return p + pick(p === 'C' ? 30 : 20); }
  if (dep === 'HKG') return String(pick(80));
  if (['NRT','HND'].includes(dep)) return String(pick(60));
  if (dep === 'ICN') return String(100 + pick(50));
  if (['PVG','PEK','CAN'].includes(dep)) return String(pick(50));
  if (dep === 'TPE') return 'A' + pick(20);
  if (dep === 'MNL') return String(pick(20));
  if (['CGK','DPS'].includes(dep)) return 'D' + pick(30);

  // Fallback quốc tế chưa biết
  return 'ABCDE'[h % 5] + pick(15);
};

// ─── Checkin Functions ─────────────────────────

// Kiểm tra booking có thể check-in không
const checkBookingCheckinStatus = async (bookingCode) => {
  const pool = db;
  
  const result = await pool.query(SQ.CHECK_BOOKING_CHECKIN_STATUS, [bookingCode]);
  
  if (result.rows.length === 0) {
    throw new Error('Booking khong ton tai');
  }
  
  const booking = result.rows[0];
  
  // Validate booking status
  if (booking.booking_status !== 'confirmed') {
    throw new Error('Booking chua duoc xac nhan');
  }
  
  // Validate checkin time
  const departureTime = new Date(booking.departure_time);
  const now = new Date();
  const hoursUntilDeparture = (departureTime - now) / (1000 * 60 * 60);
  
  if (hoursUntilDeparture < 0) {
    throw new Error('Chuyen bay da khoi hanh');
  }
  
  if (hoursUntilDeparture > CHECKIN_CONFIG.minHoursBefore) {
    throw new Error(`Vui long check-in sau ${CHECKIN_CONFIG.minHoursBefore} gio truoc gio bay`);
  }
  
  if (hoursUntilDeparture < CHECKIN_CONFIG.maxMinutesBefore / 60) {
    throw new Error(`Qua muon check-in. Vui long co mat truoc ${CHECKIN_CONFIG.maxMinutesBefore} phut`);
  }
  
  return booking;
};

// Lấy danh sách passengers cho checkin
const getPassengersForCheckin = async (bookingId, flightType) => {
  const pool = db;
  
  const result = await pool.query(SQ.GET_PASSENGERS_FOR_CHECKIN, [bookingId, flightType]);
  
  return result.rows;
};

// Lấy chi tiết booking cho boarding pass
const getBookingDetailsForCheckin = async (bookingCode) => {
  const pool = db;
  
  const result = await pool.query(SQ.GET_BOOKING_DETAILS_FOR_CHECKIN, [bookingCode]);
  
  if (result.rows.length === 0) {
    throw new Error('Booking khong ton tai');
  }
  
  return result.rows[0];
};

// Check-in 1 passenger cụ thể
const checkinPassenger = async (bookingCode, passengerId, flightType) => {
  const pool = db;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get booking
    const bookingResult = await client.query(
      'SELECT * FROM bookings WHERE booking_code = $1',
      [bookingCode]
    );
    
    if (bookingResult.rows.length === 0) {
      throw new Error('Booking khong ton tai');
    }
    
    const booking = bookingResult.rows[0];
    
    // Check passenger
    const passengerResult = await client.query(
      'SELECT * FROM passengers WHERE id = $1 AND booking_id = $2',
      [passengerId, booking.id]
    );
    
    if (passengerResult.rows.length === 0) {
      throw new Error('Hanh khach khong ton tai trong booking nay');
    }
    
    const passenger = passengerResult.rows[0];
    
    // Check if already checked in
    if (passenger.checked_in) {
      throw new Error('Hanh khach da check-in roi');
    }
    
    // Check if has seat
    const seatField = flightType === 'return' ? 'return_seat_number' : 'seat_number';
    if (!passenger[seatField]) {
      throw new Error('Hanh khach chua co ghe ngoi');
    }
    
    // Get seat number
    const seatNumber = passenger[seatField];
    
    // Determine flight
    const flightId = flightType === 'return' 
      ? booking.return_flight_id 
      : booking.outbound_flight_id;
    
    // Get flight info (bao gồm gate nếu admin đã set)
    const flightResult = await client.query(
      `SELECT f.flight_number, f.departure_time, f.arrival_time, f.gate,
              dep.code AS departure_airport, dep.country AS departure_country,
              arr.code AS arrival_airport
       FROM flights f
       JOIN airports dep ON dep.id = f.departure_airport_id
       JOIN airports arr ON arr.id = f.arrival_airport_id
       WHERE f.id = $1`,
      [flightId]
    );

    const flightRow = flightResult.rows[0] || {};
    const flightNumber = flightRow.flight_number || 'N/A';

    // Get next sequence
    const seq = await getNextSequenceNumber(booking.id, flightType);

    // Generate boarding pass code
    const boardingPassCode = generateBoardingPassCode(booking.booking_code, seq);

    // Gate: ưu tiên gate do admin set, fallback về generate tự động
    const gate = flightRow.gate || generateGate(flightNumber, flightRow.departure_airport, flightRow.departure_country);

    // Boarding time theo thực tế
    let boardingTime = null;
    if (flightRow.departure_time) {
      const mins = getBoardingMinutes(flightRow.departure_time, flightRow.arrival_time);
      boardingTime = new Date(new Date(flightRow.departure_time).getTime() - mins * 60 * 1000);
    }
    
    // Insert checkin record
    await client.query(SQ.INSERT_CHECKIN, [
      booking.id,
      passenger.id,
      flightType,
      boardingPassCode,
      seq,
      gate,
      boardingTime
    ]);
    
    // Update passenger checkin status
    await client.query(SQ.UPDATE_PASSENGER_CHECKIN_STATUS, [passenger.id]);
    
    await client.query('COMMIT');
    
    return {
      success: true,
      boarding_pass_code: boardingPassCode,
      passenger_name: passenger.full_name,
      seat_number: seatNumber,
      sequence_number: seq,
      gate,
      boarding_time: boardingTime,
      flight_number: flightNumber
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Check-in tất cả passengers của 1 booking
const checkinAllPassengers = async (bookingCode, flightType = 'outbound') => {
  const pool = db;
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get booking
    const bookingResult = await client.query(
      'SELECT * FROM bookings WHERE booking_code = $1',
      [bookingCode]
    );
    
    if (bookingResult.rows.length === 0) {
      throw new Error('Booking khong ton tai');
    }
    
    const booking = bookingResult.rows[0];

    // Validate booking status
    if (!['confirmed', 'completed'].includes(booking.status)) {
      const msg = booking.status === 'refunded'
        ? 'Vé đã được hoàn tiền, không thể check-in'
        : booking.status === 'cancelled'
        ? 'Booking đã bị hủy, không thể check-in'
        : 'Booking chưa được xác nhận thanh toán';
      throw new Error(msg);
    }

    // Validate flight status
    const flightId = flightType === 'return' ? booking.return_flight_id : booking.outbound_flight_id;
    const flightStatusRes = await client.query(
      'SELECT status FROM flights WHERE id = $1', [flightId]
    );
    if (flightStatusRes.rows[0]?.status === 'cancelled') {
      throw new Error('Chuyến bay đã bị hủy, không thể check-in');
    }

    // Fetch flight info once (bao gồm gate nếu admin đã set)
    const flightResult = await client.query(
      `SELECT f.flight_number, f.departure_time, f.arrival_time, f.gate,
              dep.code AS departure_airport, dep.country AS departure_country,
              arr.code AS arrival_airport
       FROM flights f
       JOIN airports dep ON dep.id = f.departure_airport_id
       JOIN airports arr ON arr.id = f.arrival_airport_id
       WHERE f.id = $1`,
      [flightId]
    );
    const flightRow    = flightResult.rows[0] || {};
    const flightNumber = flightRow.flight_number || 'N/A';

    // Get passengers (except infants)
    const passengersResult = await client.query(
      'SELECT * FROM passengers WHERE booking_id = $1 AND passenger_type != $2',
      [booking.id, 'infant']
    );

    const results = [];

    for (const passenger of passengersResult.rows) {
      // Determine seat field
      const seatField = flightType === 'return' ? 'return_seat_number' : 'seat_number';

      // Skip if no seat
      if (!passenger[seatField]) {
        results.push({
          passenger_id: passenger.id,
          passenger_name: passenger.full_name,
          success: false,
          error: 'Chua co ghe ngoi'
        });
        continue;
      }

      // Skip if already checked in
      if (passenger.checked_in) {
        results.push({
          passenger_id: passenger.id,
          passenger_name: passenger.full_name,
          success: false,
          error: 'Da check-in roi'
        });
        continue;
      }

      const seatNumber = passenger[seatField];

      // Get sequence
      const seq = await getNextSequenceNumber(booking.id, flightType);

      // Generate boarding pass code
      const boardingPassCode = generateBoardingPassCode(booking.booking_code, seq);

      // Gate: ưu tiên gate do admin set, fallback về generate tự động
      const gate = flightRow.gate || generateGate(flightNumber, flightRow.departure_airport, flightRow.departure_country);

      // Boarding time theo thực tế
      let boardingTime = null;
      if (flightRow.departure_time) {
        const mins = getBoardingMinutes(flightRow.departure_time, flightRow.arrival_time);
        boardingTime = new Date(new Date(flightRow.departure_time).getTime() - mins * 60 * 1000);
      }
      
      // Insert checkin
      await client.query(SQ.INSERT_CHECKIN, [
        booking.id,
        passenger.id,
        flightType,
        boardingPassCode,
        seq,
        gate,
        boardingTime
      ]);
      
      // Update passenger
      await client.query(SQ.UPDATE_PASSENGER_CHECKIN_STATUS, [passenger.id]);
      
      results.push({
        passenger_id: passenger.id,
        passenger_name: passenger.full_name,
        seat_number: seatNumber,
        success: true,
        boarding_pass_code: boardingPassCode,
        sequence_number: seq,
        gate,
        boarding_time: boardingTime,
        flight_number: flightNumber
      });
    }
    
    await client.query('COMMIT');

    return {
      success: true,
      booking_code: bookingCode,
      flight_type: flightType,
      contact_email: booking.contact_email || null,
      contact_name: booking.contact_name || null,
      passengers: results
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// Lấy thông tin boarding pass
const getBoardingPass = async (boardingPassCode) => {
  const pool = db;
  
  const result = await pool.query(SQ.SELECT_CHECKIN_BY_CODE, [boardingPassCode]);
  
  if (result.rows.length === 0) {
    throw new Error('Boarding pass khong ton tai');
  }
  
  const data = result.rows[0];
  
  // Format date/time
  const departureDate = formatDate(data.departure_time);
  const departureTime = formatTime(data.departure_time);
  let boardingTimeFormatted = null;
  if (data.boarding_time) {
    boardingTimeFormatted = formatTime(data.boarding_time);
  } else if (data.departure_time) {
    const mins = getBoardingMinutes(data.departure_time, data.arrival_time);
    boardingTimeFormatted = formatTime(new Date(new Date(data.departure_time).getTime() - mins * 60 * 1000));
  }
  
  // Generate QR code URL (placeholder - can tich hop QR generator)
  const qrCodeUrl = `/api/checkin/${boardingPassCode}/qr`;
  
  return {
    airline:           data.airline_name || 'VIVUDEE AIR',
    airline_code:      data.airline_code || '',
    airline_logo:      data.airline_logo      || null,
    airline_logo_dark: data.airline_logo_dark || null,
    type: 'BOARDING PASS',

    passenger_name: data.full_name,
    booking_code:   data.booking_code,

    flight_number: data.flight_number,
    date:          departureDate,

    departure_city:         data.departure_city,
    arrival_city:           data.arrival_city,
    departure_airport:      data.departure_airport,
    arrival_airport:        data.arrival_airport,
    departure_airport_name: data.departure_airport_name,
    arrival_airport_name:   data.arrival_airport_name,

    departure_time: departureTime,
    arrival_time:   formatTime(data.arrival_time),
    gate:           (data.gate && data.gate !== 'TBA') ? data.gate : generateGate(data.flight_number, data.departure_airport, data.departure_country),
    seat:           data.seat_number,

    sequence:          data.sequence_number,
    boarding_pass_code: data.boarding_pass_code,
    boarding_time:      boardingTimeFormatted,
  };
};

// Lấy trạng thái checkin của 1 booking
const getCheckinStatus = async (bookingCode) => {
  const pool = db;
  
  // Get booking
  const bookingResult = await pool.query(
    'SELECT * FROM bookings WHERE booking_code = $1',
    [bookingCode]
  );
  
  if (bookingResult.rows.length === 0) {
    throw new Error('Booking khong ton tai');
  }
  
  const booking = bookingResult.rows[0];
  
  // Get passengers
  const passengersResult = await pool.query(
    'SELECT * FROM passengers WHERE booking_id = $1',
    [booking.id]
  );
  
  // Get flight info with airport + airline details
  let flightInfo = null;
  const checkinInfoResult = await pool.query(
    SQ.SELECT_CHECKIN_GATE_INFO,
    [booking.id, 'outbound']
  );

  if (booking.outbound_flight_id) {
    const flightResult = await pool.query(`
      SELECT f.id, f.flight_number, f.departure_time, f.arrival_time, f.status,
        dep.code AS departure_airport, dep.city AS departure_city, dep.name AS departure_airport_name,
        arr.code AS arrival_airport, arr.city AS arrival_city, arr.name AS arrival_airport_name,
        al.name AS airline_name, al.code AS airline_code
      FROM flights f
      JOIN airports dep ON dep.id = f.departure_airport_id
      JOIN airports arr ON arr.id = f.arrival_airport_id
      JOIN airlines al ON al.id = f.airline_id
      WHERE f.id = $1
    `, [booking.outbound_flight_id]);
    if (flightResult.rows.length > 0) flightInfo = flightResult.rows[0];
  }

  return {
    booking_code: booking.booking_code,
    booking_status: booking.status,
    flight: flightInfo ? {
      flight_number:          flightInfo.flight_number,
      departure_time:         flightInfo.departure_time,
      arrival_time:           flightInfo.arrival_time,
      departure_city:         flightInfo.departure_city,
      arrival_city:           flightInfo.arrival_city,
      departure_airport:      flightInfo.departure_airport,
      arrival_airport:        flightInfo.arrival_airport,
      departure_airport_name: flightInfo.departure_airport_name,
      arrival_airport_name:   flightInfo.arrival_airport_name,
      airline_name:           flightInfo.airline_name,
      airline_code:           flightInfo.airline_code,
      status:                 flightInfo.status,
    } : null,
    passengers: passengersResult.rows.map(p => ({
      id: p.id,
      name: p.full_name,
      type: p.passenger_type,
      seat: p.seat_number,
      return_seat: p.return_seat_number,
      checked_in: p.checked_in,
      checked_in_at: p.checked_in_at
    })),
    gate: checkinInfoResult.rows[0]?.gate || null,
    boarding_time: checkinInfoResult.rows[0]?.boarding_time || null
  };
};

module.exports = {
  // Checkin
  checkinPassenger,
  checkinAllPassengers,
  checkBookingCheckinStatus,
  getCheckinStatus,
  
  // Boarding Pass
  getBoardingPass,
  
  // Helpers
  generateBoardingPassCode,
  formatDate,
  formatTime,

  // Config
  CHECKIN_CONFIG,
};
