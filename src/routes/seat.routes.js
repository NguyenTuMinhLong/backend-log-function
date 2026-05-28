'use strict';

/*
=========================================================
SEAT ROUTES - API endpoints cho seat selection
=========================================================
*/

const express = require('express');
const router = express.Router();
const seatController = require('../controllers/seat.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// =========================================================
// SEAT MAP ENDPOINTS (Public)
// =========================================================

/**
 * GET /api/flights/:flightId/seats
 * Lay seat map cua 1 chuyen bay
 * Query: ?seat_class=economy
 */
router.get('/flights/:flightId/seats', seatController.getSeatMap);

/**
 * GET /api/flights/:flightId/seats/pricing
 * Lay gia tri them cho tung vi tri ghe
 */
router.get('/flights/:flightId/seats/pricing', seatController.getSeatPricing);

// =========================================================
// SEAT SELECTION ENDPOINTS (Require Auth)
// =========================================================

/**
 * GET /api/bookings/:bookingCode/seats
 * Lay thong tin ghe da assign cho booking
 */
router.get('/bookings/:bookingCode/seats', seatController.getBookingSeats);

/**
 * POST /api/bookings/:bookingCode/seats
 * Chon ghe cu the cho booking
 * Body: { selections: [{ passenger_id, flight_type, seat_number }] }
 */
router.post('/bookings/:bookingCode/seats', authenticate, seatController.selectSeats);

/**
 * POST /api/bookings/:bookingCode/seats/auto
 * Tu dong assign ghe ngau nhien cho booking
 */
router.post('/bookings/:bookingCode/seats/auto', authenticate, seatController.autoAssignSeats);

module.exports = router;
