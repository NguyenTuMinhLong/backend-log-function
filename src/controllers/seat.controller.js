'use strict';

/*
=========================================================
SEAT CONTROLLER - API endpoints cho seat selection
=========================================================
*/

const seatService = require('../services/seat.service');

// =========================================================
// SEAT MAP ENDPOINTS
// =========================================================

/**
 * GET /api/flights/:flightId/seats
 * Lay seat map cua 1 chuyen bay
 * Query: ?seat_class=economy
 */
const getSeatMap = async (req, res) => {
  try {
    const { flightId } = req.params;
    const { seat_class } = req.query;

    if (!flightId) {
      return res.status(400).json({ error: 'Flight ID la bat buoc' });
    }

    let result;

    if (seat_class) {
      // Lay seat map cho 1 class cu the
      result = await seatService.getSeatMap(parseInt(flightId), seat_class);
    } else {
      // Lay tat ca seat maps
      result = await seatService.getAllSeatMaps(parseInt(flightId));
    }

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[SeatMap]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/flights/:flightId/seats/pricing
 * Lay gia tri them cho tung vi tri ghe
 * Query: ?seat_class=economy
 */
const getSeatPricing = async (req, res) => {
  try {
    const { flightId } = req.params;
    const { seat_class } = req.query;

    if (!flightId || !seat_class) {
      return res.status(400).json({ 
        error: 'Flight ID va Seat Class la bat buoc' 
      });
    }

    const pricingResult = await seatService.getSeatMap(
      parseInt(flightId), 
      seat_class
    );

    // Extract pricing rules only
    const pricingRules = pricingResult.pricing_rules || {};

    res.json({
      success: true,
      data: {
        flight_id: parseInt(flightId),
        seat_class,
        pricing_rules: pricingRules
      }
    });
  } catch (err) {
    console.error('[SeatPricing]', err.message);
    res.status(400).json({ error: err.message });
  }
};

// =========================================================
// SEAT SELECTION ENDPOINTS
// =========================================================

/**
 * POST /api/bookings/:bookingCode/seats
 * Chon ghe cu the cho booking
 * Body: { selections: [{ passenger_id, flight_type, seat_number }] }
 */
const selectSeats = async (req, res) => {
  try {
    const { bookingCode } = req.params;
    const { selections } = req.body;

    if (!bookingCode) {
      return res.status(400).json({ error: 'Booking code la bat buoc' });
    }

    if (!selections || !Array.isArray(selections) || selections.length === 0) {
      return res.status(400).json({ 
        error: 'Danh sach chon ghe (selections) la bat buoc' 
      });
    }

    // Validate each selection
    for (const sel of selections) {
      if (!sel.passenger_id) {
        return res.status(400).json({ 
          error: 'passenger_id la bat buoc trong moi selection' 
        });
      }
      if (!sel.seat_number) {
        return res.status(400).json({ 
          error: 'seat_number la bat buoc trong moi selection' 
        });
      }
      if (!sel.flight_type) {
        return res.status(400).json({ 
          error: 'flight_type la bat buoc trong moi selection' 
        });
      }
    }

    const result = await seatService.selectSeats(
      bookingCode.toUpperCase(), 
      selections
    );

    res.status(200).json({
      success: true,
      message: 'Chon ghe thanh cong',
      data: result
    });
  } catch (err) {
    console.error('[SelectSeats]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/bookings/:bookingCode/seats/auto
 * Tu dong assign ghe ngau nhien cho booking
 */
const autoAssignSeats = async (req, res) => {
  try {
    const { bookingCode } = req.params;

    if (!bookingCode) {
      return res.status(400).json({ error: 'Booking code la bat buoc' });
    }

    const result = await seatService.autoAssignSeats(bookingCode.toUpperCase());

    res.status(200).json({
      success: true,
      message: 'Ghe da duoc tu dong assign',
      data: result
    });
  } catch (err) {
    console.error('[AutoAssignSeats]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/:bookingCode/seats
 * Lay thong tin ghe da assign cho booking
 */
const getBookingSeats = async (req, res) => {
  try {
    const { bookingCode } = req.params;

    if (!bookingCode) {
      return res.status(400).json({ error: 'Booking code la bat buoc' });
    }

    // Get booking info
    const pool = require('../config/database').getPool();
    const bookingResult = await pool.query(
      'SELECT * FROM bookings WHERE booking_code = $1',
      [bookingCode.toUpperCase()]
    );

    if (bookingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Booking khong ton tai' });
    }

    const booking = bookingResult.rows[0];

    // Get passengers with seats
    const passengersResult = await pool.query(
      `SELECT id, full_name, passenger_type, seat_number, return_seat_number
       FROM passengers WHERE booking_id = $1`,
      [booking.id]
    );

    res.json({
      success: true,
      data: {
        booking_code: booking.booking_code,
        seat_selection_type: booking.seat_selection_type || 'random',
        seat_extra_fee: parseFloat(booking.seat_extra_fee || 0),
        passengers: passengersResult.rows
      }
    });
  } catch (err) {
    console.error('[GetBookingSeats]', err.message);
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  // Seat Map
  getSeatMap,
  getSeatPricing,
  
  // Seat Selection
  selectSeats,
  autoAssignSeats,
  getBookingSeats,
};
