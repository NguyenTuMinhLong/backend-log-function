const express = require("express");
const router = express.Router();

// Controllers
const bookingController = require("../controllers/booking.controller");
const flightController = require("../controllers/flight.controller");

// Middlewares
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// Lịch sử booking của tôi: phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);
// http://localhost:3000/api/bookings/my?filter=all|upcoming|completed|cancelled|expired&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD

// Flight Recommendation (mới)
router.get("/recommendations", flightController.getFlightRecommendations);

// Tạo booking
router.post("/", authenticateOptional, bookingController.createBooking);

// ==================== DYNAMIC ROUTES (phải để sau) ====================

// Xem chi tiết booking (dynamic)
router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);

// Hủy booking (dynamic)
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;