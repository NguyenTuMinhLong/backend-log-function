'use strict';

/*
=========================================================
SEAT SERVICE - Xu ly chon ghe va seat selection
=========================================================
Hai luong:
1. Random Seat (free) - He thong tu dong assign
2. Choose Seat (tra phi) - Khach chon ghe cu the

Chi tiet:
- First class: Luon duoc chon ghe (khong can tra phi)
- Business/Economy: 
  - Khong chon: Random (free)
  - Chon ghe: Tra phi them
=========================================================
*/

const db = require('../config/database');
const SQ = require('../queries/seat.queries');
const QB = require('../queries/booking.queries');

// =========================================================
// HELPER FUNCTIONS
// =========================================================

/**
 * Lay vi tri ghe: window (A, F) hoac standard
 */
const getSeatPosition = (seatNumber) => {
  if (seatNumber.endsWith('A') || seatNumber.endsWith('F')) {
    return 'window';
  }
  return 'standard';
};

/**
 * Tinh phi them cho ghe da chon
 */
const calculateExtraFee = async (flightId, seatClass, position) => {
  const pool = db.getPool();
  const result = await pool.query(SQ.SELECT_SEAT_PRICING_BY_CLASS, [flightId, seatClass]);
  
  const pricing = result.rows.find(p => p.position === position);
  return pricing ? parseFloat(pricing.extra_price) : 0;
};

/**
 * Get random available seat
 */
const getRandomAvailableSeat = async (flightId, seatClass) => {
  const pool = db.getPool();
  
  // Lay tat ca ghe trong của class
  const allSeats = await pool.query(SQ.SELECT_SEAT_MAP, [flightId, seatClass]);
  const availableSeats = allSeats.rows.filter(s => s.status === 'available');
  
  if (availableSeats.length === 0) {
    return null;
  }
  
  //Uu tien ghe standard (khong phai window)
  const standardSeats = availableSeats.filter(s => s.position === 'standard');
  
  // Neu co ghe standard, chi lay ghe standard
  // Neu khong con, moi lay window
  const seatPool = standardSeats.length > 0 ? standardSeats : availableSeats;
  
  const randomIndex = Math.floor(Math.random() * seatPool.length);
  return seatPool[randomIndex];
};

// =========================================================
// SEAT MAP FUNCTIONS
// =========================================================

/**
 * Lay seat map cua 1 chuyen bay
 * @param {number} flightId - ID cua chuyen bay
 * @param {string} seatClass - Loai ghe (economy, business, first)
 */
const getSeatMap = async (flightId, seatClass) => {
  const pool = db.getPool();
  
  // Lay seat map
  const seatResult = await pool.query(SQ.SELECT_SEAT_MAP, [flightId, seatClass]);
  
  // Lay pricing mac dinh
  const pricingResult = await pool.query(SQ.SELECT_SEAT_PRICING_BY_CLASS, [flightId, seatClass]);
  
  // Lay summary
  const summaryResult = await pool.query(SQ.SELECT_SEAT_MAP_SUMMARY, [flightId]);
  
  // Format seat map
  const seats = seatResult.rows.map(seat => ({
    seat_number: seat.seat_number,
    class: seat.class,
    status: seat.status,
    position: seat.position,
    extra_price: parseFloat(seat.extra_price) || 0,
    available: seat.status === 'available'
  }));
  
  // Format pricing rules
  const pricingRules = {};
  pricingResult.rows.forEach(p => {
    pricingRules[p.position] = parseFloat(p.extra_price);
  });
  
  return {
    flight_id: flightId,
    seat_class: seatClass,
    seats,
    pricing_rules: pricingRules,
    summary: summaryResult.rows
  };
};

/**
 * Lay tat ca seat classes cua 1 chuyen bay
 */
const getAllSeatMaps = async (flightId) => {
  const classes = ['economy', 'business', 'first'];
  const results = {};
  
  for (const seatClass of classes) {
    results[seatClass] = await getSeatMap(flightId, seatClass);
  }
  
  return results;
};

// =========================================================
// SEAT SELECTION FUNCTIONS
// =========================================================

/**
 * Validate seat selection
 */
const validateSeatSelection = async (flightId, seatClass, seatNumber) => {
  const pool = db.getPool();
  
  // Check flight exists
  const flightResult = await pool.query(
    'SELECT id FROM flights WHERE id = $1',
    [flightId]
  );
  if (flightResult.rows.length === 0) {
    throw new Error('Chuyen bay khong ton tai');
  }
  
  // Check seat exists trong flight
  const seatResult = await pool.query(
    'SELECT * FROM flight_seat_assignments WHERE flight_id = $1 AND seat_number = $2 AND class = $3',
    [flightId, seatNumber, seatClass]
  );
  
  if (seatResult.rows.length === 0) {
    throw new Error('Ghe khong ton tai trong chuyen bay nay');
  }
  
  if (seatResult.rows[0].status === 'occupied') {
    throw new Error('Ghe da duoc chiem');
  }
  
  return true;
};

/**
 * Assign seat cho 1 passenger
 */
const assignSeat = async (flightId, seatClass, seatNumber, passengerId, bookingId) => {
  const pool = db.getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Validate seat
    await validateSeatSelection(flightId, seatClass, seatNumber);
    
    // Update seat status
    await client.query(SQ.UPDATE_SEAT_STATUS, [
      'occupied', passengerId, bookingId, flightId, seatNumber
    ]);
    
    // Update passenger seat
    await client.query(SQ.UPDATE_PASSENGER_SEAT, [seatNumber, passengerId]);
    
    await client.query('COMMIT');
    
    return {
      success: true,
      seat_number: seatNumber,
      seat_class: seatClass,
      passenger_id: passengerId
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Select multiple seats cho 1 booking
 * @param {string} bookingCode - Ma booking
 * @param {Array} selections - [{ passenger_id, flight_type, seat_number }]
 */
const selectSeats = async (bookingCode, selections) => {
  const pool = db.getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get booking info
    const bookingResult = await client.query(
      'SELECT * FROM bookings WHERE booking_code = $1',
      [bookingCode]
    );
    
    if (bookingResult.rows.length === 0) {
      throw new Error('Booking khong ton tai');
    }
    
    const booking = bookingResult.rows[0];
    
    // Calculate total extra fee
    let totalExtraFee = 0;
    const results = [];
    
    for (const selection of selections) {
      // Determine flight ID based on flight_type
      const flightId = selection.flight_type === 'return' 
        ? booking.return_flight_id 
        : booking.outbound_flight_id;
      
      const seatClass = selection.flight_type === 'return'
        ? booking.return_seat_class
        : booking.outbound_seat_class;
      
      // Validate & assign seat
      await validateSeatSelection(flightId, seatClass, selection.seat_number);
      
      // Calculate extra fee
      const position = getSeatPosition(selection.seat_number);
      const extraFee = await calculateExtraFee(flightId, seatClass, position);
      
      // Update seat
      await client.query(SQ.UPDATE_SEAT_STATUS, [
        'occupied', selection.passenger_id, booking.id, flightId, selection.seat_number
      ]);
      
      // Update passenger
      await client.query(SQ.UPDATE_PASSENGER_SEAT, [selection.seat_number, selection.passenger_id]);
      
      totalExtraFee += extraFee;
      
      results.push({
        passenger_id: selection.passenger_id,
        seat_number: selection.seat_number,
        extra_price: extraFee
      });
    }
    
    // Update booking with seat selection info
    await client.query(SQ.UPDATE_BOOKING_SEAT_SELECTION, ['chosen', totalExtraFee, booking.id]);
    
    await client.query('COMMIT');
    
    return {
      success: true,
      booking_code: bookingCode,
      selections: results,
      total_extra_fee: totalExtraFee
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Auto-assign random seats cho tat ca passengers cua 1 booking
 */
const autoAssignSeats = async (bookingCode) => {
  const pool = db.getPool();
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get booking info
    const bookingResult = await client.query(
      'SELECT * FROM bookings WHERE booking_code = $1',
      [bookingCode]
    );
    
    if (bookingResult.rows.length === 0) {
      throw new Error('Booking khong ton tai');
    }
    
    const booking = bookingResult.rows[0];
    
    // Get passengers (khong tinh infant)
    const passengersResult = await client.query(
      'SELECT * FROM passengers WHERE booking_id = $1 AND passenger_type != $2 ORDER BY passenger_type, id',
      [booking.id, 'infant']
    );
    
    const assignments = [];
    
    // Assign for outbound flight
    const outboundSeats = [];
    for (const passenger of passengersResult.rows) {
      const seat = await getRandomAvailableSeat(booking.outbound_flight_id, booking.outbound_seat_class);
      
      if (!seat) {
        throw new Error('Khong con ghe trong cho chuyen bay di');
      }
      
      // Update seat
      await client.query(SQ.UPDATE_SEAT_STATUS, [
        'occupied', passenger.id, booking.id, booking.outbound_flight_id, seat.seat_number
      ]);
      
      // Update passenger
      await client.query(SQ.UPDATE_PASSENGER_SEAT, [seat.seat_number, passenger.id]);
      
      outboundSeats.push({
        passenger_id: passenger.id,
        seat_number: seat.seat_number,
        flight_type: 'outbound'
      });
    }
    
    assignments.push(...outboundSeats);
    
    // Assign for return flight (neu la round trip)
    if (booking.trip_type === 'round_trip' && booking.return_flight_id) {
      for (const passenger of passengersResult.rows) {
        const seat = await getRandomAvailableSeat(booking.return_flight_id, booking.return_seat_class);
        
        if (!seat) {
          throw new Error('Khong con ghe trong cho chuyen bay ve');
        }
        
        // Update seat
        await client.query(SQ.UPDATE_SEAT_STATUS, [
          'occupied', passenger.id, booking.id, booking.return_flight_id, seat.seat_number
        ]);
        
        // Update passenger (them return seat)
        // Neu da co seat_number, ghi de hoac them field moi
        await client.query(
          'UPDATE passengers SET return_seat_number = $1 WHERE id = $2',
          [seat.seat_number, passenger.id]
        );
        
        assignments.push({
          passenger_id: passenger.id,
          seat_number: seat.seat_number,
          flight_type: 'return'
        });
      }
    }
    
    // Update booking
    await client.query(SQ.UPDATE_BOOKING_SEAT_SELECTION, ['random', 0, booking.id]);
    
    await client.query('COMMIT');
    
    return {
      success: true,
      booking_code: bookingCode,
      seat_selection_type: 'random',
      assignments
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Release a seat (when cancelling booking)
 */
const releaseSeat = async (flightId, seatNumber) => {
  const pool = db.getPool();
  
  await pool.query(SQ.RELEASE_SEAT, [flightId, seatNumber]);
  
  return { success: true, seat_number: seatNumber };
};

module.exports = {
  // Seat Map
  getSeatMap,
  getAllSeatMaps,
  
  // Seat Selection
  selectSeats,
  autoAssignSeats,
  assignSeat,
  validateSeatSelection,
  releaseSeat,
  
  // Helpers
  getSeatPosition,
  calculateExtraFee,
  getRandomAvailableSeat,
};
