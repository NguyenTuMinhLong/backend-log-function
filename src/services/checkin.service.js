'use strict';

/*
=========================================================
CHECKIN SERVICE - Xu ly check-in online
=========================================================
Input: Booking code hoac QR code
Output: Boarding pass info

Quy trinh:
1. Validate booking (ton tai, chua check-in, trong thoi gian)
2. Generate boarding pass cho moi passenger
3. Tra ve boarding pass info
=========================================================
*/

const db = require('../config/database');
const SQ = require('../queries/seat.queries');

// =========================================================
// CONFIGURATION
// =========================================================

const CHECKIN_CONFIG = {
  // Cho phep check-in truoc bao nhieu gio
  minHoursBefore: 24,
  // Khong cho check-in sau bao nhieu phut
  maxMinutesBefore: 30,
  // Gate mac dinh neu chua co
  defaultGate: 'TBA',
};

// =========================================================
// HELPER FUNCTIONS
// =========================================================

/**
 * Generate boarding pass code
 * Format: {BOOKING_CODE}-{PASSENGER_INDEX}
 * VD: VJ8PKSL-P1
 */
const generateBoardingPassCode = (bookingCode, passengerIndex) => {
  return `${bookingCode}-P${passengerIndex}`;
};

/**
 * Get next sequence number
 */
const getNextSequenceNumber = async (bookingId, flightType) => {
  const pool = db.getPool();
  const result = await pool.query(SQ.GET_NEXT_SEQUENCE_NUMBER, [bookingId, flightType]);
  return result.rows[0]?.next_seq || 1;
};

/**
 * Format date for boarding pass
 */
const formatDate = (dateString) => {
  const date = new Date(dateString);
  const options = { day: '2-digit', month: 'short', year: 'numeric' };
  return date.toLocaleDateString('en-GB', options).toUpperCase();
};

/**
 * Format time for boarding pass
 */
const formatTime = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
};

// =========================================================
// CHECKIN FUNCTIONS
// =========================================================

/**
 * Check booking status for checkin
 */
const checkBookingCheckinStatus = async (bookingCode) => {
  const pool = db.getPool();
  
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

/**
 * Get all passengers for a booking
 */
const getPassengersForCheckin = async (bookingId, flightType) => {
  const pool = db.getPool();
  
  const result = await pool.query(SQ.GET_PASSENGERS_FOR_CHECKIN, [bookingId, flightType]);
  
  return result.rows;
};

/**
 * Get booking details for boarding pass
 */
const getBookingDetailsForCheckin = async (bookingCode) => {
  const pool = db.getPool();
  
  const result = await pool.query(SQ.GET_BOOKING_DETAILS_FOR_CHECKIN, [bookingCode]);
  
  if (result.rows.length === 0) {
    throw new Error('Booking khong ton tai');
  }
  
  return result.rows[0];
};

/**
 * Check-in cho 1 passenger cu the
 */
const checkinPassenger = async (bookingCode, passengerId, flightType) => {
  const pool = db.getPool();
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
    
    // Get flight info
    const flightResult = await client.query(
      'SELECT flight_number FROM flights WHERE id = $1',
      [flightId]
    );
    
    const flightNumber = flightResult.rows[0]?.flight_number || 'N/A';
    
    // Get next sequence
    const seq = await getNextSequenceNumber(booking.id, flightType);
    
    // Generate boarding pass code
    const boardingPassCode = generateBoardingPassCode(booking.booking_code, seq);
    
    // Determine gate
    const gate = booking.gate || CHECKIN_CONFIG.defaultGate;
    
    // Determine boarding time (thuong 30 phut truoc gio bay)
    let boardingTime = null;
    if (booking.departure_time) {
      const depTime = new Date(booking.departure_time);
      boardingTime = new Date(depTime.getTime() - 30 * 60 * 1000);
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

/**
 * Check-in tat ca passengers cua 1 booking cho 1 flight
 */
const checkinAllPassengers = async (bookingCode, flightType = 'outbound') => {
  const pool = db.getPool();
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
      
      // Get flight number
      const flightId = flightType === 'return' 
        ? booking.return_flight_id 
        : booking.outbound_flight_id;
      
      const flightResult = await client.query(
        'SELECT flight_number FROM flights WHERE id = $1',
        [flightId]
      );
      
      const flightNumber = flightResult.rows[0]?.flight_number || 'N/A';
      
      // Get sequence
      const seq = await getNextSequenceNumber(booking.id, flightType);
      
      // Generate boarding pass code
      const boardingPassCode = generateBoardingPassCode(booking.booking_code, seq);
      
      // Determine gate
      const gate = booking.gate || CHECKIN_CONFIG.defaultGate;
      
      // Determine boarding time
      let boardingTime = null;
      if (booking.departure_time) {
        const depTime = new Date(booking.departure_time);
        boardingTime = new Date(depTime.getTime() - 30 * 60 * 1000);
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
      passengers: results
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Get boarding pass info
 */
const getBoardingPass = async (boardingPassCode) => {
  const pool = db.getPool();
  
  const result = await pool.query(SQ.SELECT_CHECKIN_BY_CODE, [boardingPassCode]);
  
  if (result.rows.length === 0) {
    throw new Error('Boarding pass khong ton tai');
  }
  
  const data = result.rows[0];
  
  // Format date/time
  const departureDate = formatDate(data.departure_time);
  const departureTime = formatTime(data.departure_time);
  const boardingTimeFormatted = data.boarding_time ? formatTime(data.boarding_time) : null;
  
  // Generate QR code URL (placeholder - can tich hop QR generator)
  const qrCodeUrl = `/api/checkin/${boardingPassCode}/qr`;
  
  return {
    airline: 'VIETJET AIR',
    type: 'BOARDING PASS',
    domestic: data.departure_airport && data.arrival_airport ? 
      `${data.departure_airport} - ${data.arrival_airport}` : 'Domestic',
    
    passenger_name: data.full_name,
    booking_code: data.booking_code,
    
    flight_number: data.flight_number,
    date: departureDate,
    
    route: `${data.departure_city} - ${data.arrival_city}`,
    departure_city: data.departure_city,
    arrival_city: data.arrival_city,
    departure_airport: data.departure_airport,
    arrival_airport: data.arrival_airport,
    
    departure_time: departureTime,
    gate: data.gate || CHECKIN_CONFIG.defaultGate,
    seat: data.seat_number,
    
    sequence: data.sequence_number,
    boarding_pass_code: data.boarding_pass_code,
    boarding_time: boardingTimeFormatted,
    
    qr_code_url: qrCodeUrl,
    
    // Raw data for QR generation
    qr_data: {
      booking_code: data.booking_code,
      passenger_name: data.full_name,
      flight: data.flight_number,
      date: departureDate,
      seat: data.seat_number,
      gate: data.gate,
      sequence: data.sequence_number
    }
  };
};

/**
 * Get checkin status cho 1 booking
 */
const getCheckinStatus = async (bookingCode) => {
  const pool = db.getPool();
  
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
  
  // Get flight info
  let flightInfo = null;
  if (booking.outbound_flight_id) {
    const flightResult = await pool.query(
      'SELECT * FROM flights WHERE id = $1',
      [booking.outbound_flight_id]
    );
    if (flightResult.rows.length > 0) {
      flightInfo = flightResult.rows[0];
    }
  }
  
  return {
    booking_code: booking.booking_code,
    booking_status: booking.status,
    flight: flightInfo ? {
      flight_number: flightInfo.flight_number,
      departure_time: flightInfo.departure_time,
      arrival_time: flightInfo.arrival_time,
      departure_city: flightInfo.departure_city,
      arrival_city: flightInfo.arrival_city,
      departure_airport: flightInfo.departure_airport,
      arrival_airport: flightInfo.arrival_airport
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
    gate: booking.gate,
    boarding_time: booking.boarding_time
  };
};

/**
 * Update gate for booking
 */
const updateGate = async (bookingId, gate) => {
  const pool = db.getPool();
  
  await pool.query(SQ.UPDATE_BOOKING_GATE, [gate, bookingId]);
  
  return { success: true, gate };
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
  updateGate,
  
  // Config
  CHECKIN_CONFIG,
};
