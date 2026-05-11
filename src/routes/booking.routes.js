const express = require("express");
const router = express.Router();

// Controllers
const bookingController = require("../controllers/booking.controller");
const flightController = require("../controllers/flight.controller");

// Middlewares
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

<<<<<<< HEAD
// ==================== STATIC ROUTES ====================

router.get("/my", authenticate, bookingController.getMyBookings);

// Flight Recommendation - SỬA THÀNH authenticateOptional
router.get("/recommendations", authenticateOptional, flightController.getFlightRecommendations);   // ← SỬA Ở ĐÂY
=======
// Lịch sử booking của tôi: phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);
// http://localhost:3000/api/bookings/my?filter=all|upcoming|completed|cancelled|expired&from_date=YYYY-MM-DD&to_date=YYYY-MM-DD

// Flight Recommendation (mới)
router.get("/recommendations", authenticateOptional, flightController.getFlightRecommendations);
>>>>>>> 8330f2afa7461ae83c002945279e5d708d64f2c8

// Tạo booking
router.post("/", authenticateOptional, bookingController.createBooking);

// ==================== DYNAMIC ROUTES ====================

router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;