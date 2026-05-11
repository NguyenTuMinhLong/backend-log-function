const express = require("express");
const router = express.Router();

// Controllers
const bookingController = require("../controllers/booking.controller");
const flightController = require("../controllers/flight.controller");

// Middlewares
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// ==================== STATIC ROUTES ====================

// Lịch sử booking của tôi: phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);

// Flight Recommendation - Guest và User đều dùng được
router.get("/recommendations", authenticateOptional, flightController.getFlightRecommendations);

// Tạo booking: guest hoặc user login đều được
router.post("/", authenticateOptional, bookingController.createBooking);

// ==================== DYNAMIC ROUTES ====================

// Xem chi tiết booking theo mã
router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);

// Hủy booking: chỉ user login mới được
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;