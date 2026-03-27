const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/booking.controller");
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// Lịch sử booking của tôi: phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);
// http://localhost:3000/api/bookings/my?filter=   all|upcoming|completed|cancelled|expired

// Tạo booking: guest hoặc user login đều được
router.post("/", authenticateOptional, bookingController.createBooking);

// Xem chi tiết booking: guest dùng mã PNR, user login xem booking của mình
router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);

// Hủy booking: chỉ user đã đăng nhập mới được hủy
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;