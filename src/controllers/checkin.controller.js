'use strict';

/*
=========================================================
CHECKIN CONTROLLER - API endpoints cho check-in online
=========================================================
*/

const checkinService = require('../services/checkin.service');

// =========================================================
// CHECKIN ENDPOINTS
// =========================================================

/**
 * POST /api/checkin
 * Check-in bang booking code
 * Body: { booking_code: "VJ8PKSL", flight_type: "outbound" }
 */
const checkin = async (req, res) => {
  try {
    const { booking_code, flight_type = 'outbound' } = req.body;

    if (!booking_code) {
      return res.status(400).json({ error: 'Booking code la bat buoc' });
    }

    // Check-in all passengers
    const result = await checkinService.checkinAllPassengers(
      booking_code.toUpperCase(), 
      flight_type
    );

    res.status(200).json({
      success: true,
      message: 'Check-in thanh cong',
      data: result
    });
  } catch (err) {
    console.error('[Checkin]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/checkin/passenger
 * Check-in 1 passenger cu the
 * Body: { booking_code: "VJ8PKSL", passenger_id: 123, flight_type: "outbound" }
 */
const checkinPassenger = async (req, res) => {
  try {
    const { booking_code, passenger_id, flight_type = 'outbound' } = req.body;

    if (!booking_code) {
      return res.status(400).json({ error: 'Booking code la bat buoc' });
    }
    if (!passenger_id) {
      return res.status(400).json({ error: 'Passenger ID la bat buoc' });
    }

    const result = await checkinService.checkinPassenger(
      booking_code.toUpperCase(),
      passenger_id,
      flight_type
    );

    res.status(200).json({
      success: true,
      message: 'Check-in thanh cong',
      data: result
    });
  } catch (err) {
    console.error('[CheckinPassenger]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/checkin/status/:bookingCode
 * Lay trang thai check-in cua booking
 */
const getCheckinStatus = async (req, res) => {
  try {
    const { bookingCode } = req.params;

    if (!bookingCode) {
      return res.status(400).json({ error: 'Booking code la bat buoc' });
    }

    const result = await checkinService.getCheckinStatus(bookingCode.toUpperCase());

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[GetCheckinStatus]', err.message);
    res.status(400).json({ error: err.message });
  }
};

// =========================================================
// BOARDING PASS ENDPOINTS
// =========================================================

/**
 * GET /api/checkin/:boardingPassCode/boarding-pass
 * Lay thong tin boarding pass
 */
const getBoardingPass = async (req, res) => {
  try {
    const { boardingPassCode } = req.params;

    if (!boardingPassCode) {
      return res.status(400).json({ error: 'Boarding pass code la bat buoc' });
    }

    const result = await checkinService.getBoardingPass(boardingPassCode.toUpperCase());

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('[GetBoardingPass]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/checkin/:boardingPassCode/qr
 * Generate QR code cho boarding pass
 */
const getBoardingPassQR = async (req, res) => {
  try {
    const { boardingPassCode } = req.params;

    if (!boardingPassCode) {
      return res.status(400).json({ error: 'Boarding pass code la bat buoc' });
    }

    // Get boarding pass data
    const boardingPass = await checkinService.getBoardingPass(boardingPassCode.toUpperCase());

    // Generate QR code (simple implementation - in production use qrcode library)
    // Here we just return the data that should be encoded in QR
    const qrData = JSON.stringify(boardingPass.qr_data);

    // Return QR data for client-side generation
    res.json({
      success: true,
      data: {
        boarding_pass_code: boardingPassCode,
        qr_data: qrData,
        // In production, use a QR code library:
        // const QRCode = require('qrcode');
        // const qrImage = await QRCode.toDataURL(qrData);
        qr_image_url: `/api/checkin/${boardingPassCode}/qr-image`
      }
    });
  } catch (err) {
    console.error('[GetBoardingPassQR]', err.message);
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  // Checkin
  checkin,
  checkinPassenger,
  getCheckinStatus,
  
  // Boarding Pass
  getBoardingPass,
  getBoardingPassQR,
};
