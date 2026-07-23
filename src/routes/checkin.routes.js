'use strict';

/*
=========================================================
CHECKIN ROUTES - API endpoints cho check-in online
=========================================================
*/

const express = require('express');
const router = express.Router();
const checkinController = require('../controllers/checkin.controller');

// =========================================================
// CHECKIN ENDPOINTS (Public - Booking code is sufficient)
// =========================================================

/**
 * POST /api/checkin
 * Check-in bang booking code
 * Body: { booking_code: "VJ8PKSL", flight_type: "outbound" }
 */
router.post('/', checkinController.checkin);

/**
 * POST /api/checkin/passenger
 * Check-in 1 passenger cu the
 * Body: { booking_code: "VJ8PKSL", passenger_id: 123, flight_type: "outbound" }
 */
router.post('/passenger', checkinController.checkinPassenger);

/**
 * GET /api/checkin/status/:bookingCode
 * Lay trang thai check-in cua booking
 */
router.get('/status/:bookingCode', checkinController.getCheckinStatus);

/**
 * GET /api/checkin/:boardingPassCode/boarding-pass
 * Lay thong tin boarding pass
 */
router.get('/:boardingPassCode/boarding-pass', checkinController.getBoardingPass);

/**
 * GET /api/checkin/:boardingPassCode/qr
 * Lay QR data cho boarding pass
 */
router.get('/:boardingPassCode/qr', checkinController.getBoardingPassQR);

module.exports = router;
