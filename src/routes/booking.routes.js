const express = require("express");
const router = express.Router();

// Controllers
const bookingController = require("../controllers/booking.controller");
const flightController = require("../controllers/flight.controller");

// Middlewares
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// ==================== STATIC ROUTES ====================

router.get("/my", authenticate, bookingController.getMyBookings);

// Flight Recommendation - SỬA THÀNH authenticateOptional
router.get("/recommendations", authenticateOptional, flightController.getFlightRecommendations);   // ← SỬA Ở ĐÂY

// Tạo booking
router.post("/", authenticateOptional, bookingController.createBooking);

// ==================== DYNAMIC ROUTES ====================

router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;