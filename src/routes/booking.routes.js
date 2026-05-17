const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/booking.controller");
const flightController = require("../controllers/flight.controller");
const refundController = require("../controllers/refund.controller");
const dateChangeController = require("../controllers/date-change.controller");
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// ==================== STATIC ROUTES ====================

// Lịch sử booking của tôi: phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);

// Flight Recommendation (mới)
router.get("/recommendations", flightController.getFlightRecommendations);

// Tạo booking
router.post("/", authenticateOptional, bookingController.createBooking);

// ==================== BOOKING REFUND ROUTES ====================

// Yêu cầu hoàn tiền
router.post("/:bookingCode/refund", authenticate, refundController.requestRefund);

// Xem refunds của 1 booking
router.get("/:bookingCode/refunds", authenticateOptional, refundController.getBookingRefunds);

// Yêu cầu đổi ngày bay
router.post("/:bookingCode/change-flight", authenticate, dateChangeController.requestDateChange);

// Xem date changes của 1 booking
router.get("/:bookingCode/date-changes", authenticateOptional, dateChangeController.getBookingDateChanges);

// ==================== DYNAMIC ROUTES (phải để sau) ====================

// Xem chi tiết booking (dynamic)
router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);

// Hủy booking (dynamic)
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;