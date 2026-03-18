const express = require("express");
const router  = express.Router();
const bookingController = require("../controllers/booking.controller");
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// /my phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);

// Tạo booking: guest hoặc user login đều được
router.post("/", authenticateOptional, bookingController.createBooking);

// Xem chi tiết: guest dùng mã PNR, user login xem booking của mình
router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);

// Hủy: guest dùng mã PNR, user login hủy booking của mình
router.post("/:bookingCode/cancel", authenticateOptional, bookingController.cancelBooking);

module.exports = router;