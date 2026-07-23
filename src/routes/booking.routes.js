const express = require("express");
const router = express.Router();
const bookingController = require("../controllers/booking.controller");
const refundController = require("../controllers/refund.controller");
const dateChangeController  = require("../controllers/date-change.controller");
const ancillaryController   = require("../controllers/ancillary.controller");
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// ==================== STATIC ROUTES ====================

// Lịch sử booking của tôi: phải đăng nhập
router.get("/my", authenticate, bookingController.getMyBookings);

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

// ==================== ANCILLARY ROUTES ====================

// SB-04: Xem dịch vụ bổ sung đã chọn của booking
router.get("/:bookingCode/ancillaries", authenticateOptional, ancillaryController.getBookingAncillaries);

// SB-04: Thêm dịch vụ bổ sung cho hành khách
router.post("/:bookingCode/ancillaries", authenticateOptional, ancillaryController.addAncillary);

// SB-04: Huỷ 1 dịch vụ bổ sung
router.delete("/:bookingCode/ancillaries/:ancillaryId", authenticateOptional, ancillaryController.removeAncillary);

// SB-04: Tổng tiền booking + ancillaries
router.get("/:bookingCode/total", authenticateOptional, ancillaryController.getBookingTotal);

// ==================== DYNAMIC ROUTES (phải để sau) ====================

// Xem chi tiết booking (dynamic)
router.get("/:bookingCode", authenticateOptional, bookingController.getBookingDetail);

// Hủy booking (dynamic)
router.post("/:bookingCode/cancel", authenticate, bookingController.cancelBooking);

module.exports = router;