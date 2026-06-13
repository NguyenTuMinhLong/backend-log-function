const express = require("express");
const router = express.Router();

const { authenticate, authorize } = require("../middlewares/auth.middleware");

const adminFlightController = require("../controllers/admin/flight.controller");
const adminAirportController = require("../controllers/admin/airport.controller");
const adminAirlineController = require("../controllers/admin/airline.controller");
const adminCouponController = require("../controllers/admin/coupon.controller");
const adminRefundController = require("../controllers/admin/refund.controller");
const adminDateChangeController = require("../controllers/admin/date-change.controller");
const adminFlightCancellationController = require("../controllers/admin/flight-cancellation.controller");

const adminUserController = require("../controllers/admin/user.controller");
const adminChatController = require("../controllers/admin/chat.controller");
const adminCronController      = require("../controllers/admin/cron.controller");
const adminAutoFlightController = require("../controllers/admin/auto-flight.controller");
const adminPriceOverrideController = require("../controllers/admin/price-override.controller");

// Tất cả routes admin: phải đăng nhập + role = 'admin'
router.use(authenticate, authorize("admin"));

// A-01: Manage Flights
router.get("/flights", adminFlightController.getFlights);
router.post("/flights", adminFlightController.createFlight);
router.put("/flights/:id", adminFlightController.updateFlight);
router.patch("/flights/:id/status", adminFlightController.updateFlightStatus);
router.patch("/flights/:id/visibility", adminFlightController.toggleFlightVisibility);

// A-01 EXTRA: Flight Cancellation with Auto Refund
router.post("/flights/:flightId/cancel-with-refunds", adminFlightCancellationController.cancelFlightWithRefunds);
router.get("/flights/:flightId/affected-bookings", adminFlightCancellationController.getAffectedBookings);

// A-02: Manage Airports
router.get("/airports", adminAirportController.getAirports);
router.post("/airports", adminAirportController.createAirport);
router.put("/airports/:id", adminAirportController.updateAirport);
router.patch("/airports/:id/status", adminAirportController.updateAirportStatus);

// A-03: Manage Airlines
router.get("/airlines", adminAirlineController.getAirlines);
router.post("/airlines", adminAirlineController.createAirline);
router.put("/airlines/:id", adminAirlineController.updateAirline);
router.patch("/airlines/:id/status", adminAirlineController.updateAirlineStatus);

// A-04: Manage Users
router.get("/users", adminUserController.getUsers);
router.get("/users/:id", adminUserController.getUserById);
router.patch("/users/:id/status", adminUserController.updateUserStatus);
router.patch("/users/:id/role", adminUserController.updateUserRole);

// A-05: Manage Coupons
router.get("/coupons", adminCouponController.getCoupons);
router.get("/coupons/:id", adminCouponController.getCouponById);
router.post("/coupons", adminCouponController.createCoupon);
router.put("/coupons/:id", adminCouponController.updateCoupon);
router.patch("/coupons/:id/status", adminCouponController.updateCouponStatus);
router.delete("/coupons/:id", adminCouponController.deleteCoupon);

// AD-03: Recurring Flight Schedules + AD-04: Manual Generate
router.get("/schedules", adminFlightController.getSchedules);
router.post("/schedules", adminFlightController.createSchedule);
router.patch("/schedules/:id/status", adminFlightController.updateScheduleStatus);
router.delete("/schedules/:id", adminFlightController.deleteSchedule);
router.post("/schedules/generate", adminFlightController.triggerGenerateFlights);

// A-06: Manage Bookings
router.get("/bookings", adminFlightController.getBookings);
router.get("/bookings/:id", adminFlightController.getBookingDetailAdmin);
router.patch("/bookings/:id/status", adminFlightController.updateBookingStatus);

// A-07: Reports / Statistics
router.get("/statistics", adminFlightController.getStatistics);

// A-08: Refund Management
router.get("/refunds", adminRefundController.getRefunds);
router.get("/refunds/pending", adminRefundController.getPendingRefunds);
router.get("/refunds/stats", adminRefundController.getRefundStats);
router.get("/refunds/:refundCode", adminRefundController.getRefundDetail);
router.post("/refunds/:refundCode/approve", adminRefundController.approveRefund);
router.post("/refunds/:refundCode/reject", adminRefundController.rejectRefund);
router.post("/refunds/:refundCode/complete", adminRefundController.completeRefund);
router.post("/refunds/:refundCode/cancel", adminRefundController.cancelRefund);

// A-09: Date Change Management
router.get("/date-changes", adminDateChangeController.getDateChanges);
router.get("/date-changes/pending", adminDateChangeController.getPendingDateChanges);
router.get("/date-changes/:requestCode", adminDateChangeController.getDateChangeDetail);
router.post("/date-changes/:requestCode/approve", adminDateChangeController.approveDateChange);
router.post("/date-changes/:requestCode/reject", adminDateChangeController.rejectDateChange);
router.delete("/date-changes/:requestCode", adminDateChangeController.cancelDateChange);

// A-12: Auto Multi-Airline Flight Generator
router.get("/auto-flights/status",  adminAutoFlightController.getStatus);
router.get("/auto-flights/config",  adminAutoFlightController.getConfig);
router.put("/auto-flights/config",  adminAutoFlightController.saveConfig);
router.post("/auto-flights/run",          adminAutoFlightController.runNow);
router.post("/auto-flights/run-all",     adminAutoFlightController.runAll);
router.post("/auto-flights/from-airport",    adminAutoFlightController.runFromAirport);

// A-11: Cronjob Manual Trigger
router.post("/cron/run",              adminCronController.runCron);
router.post("/cron/expired-bookings", adminCronController.runExpiredBookings);
router.post("/cron/hide-old-flights", adminCronController.hideOldFlights);
router.post("/loyalty/recalculate",   adminCronController.recalculateLoyalty);

// A-13: Price Overrides (Season Pricing)
router.get("/price-overrides", adminPriceOverrideController.getOverrides);
router.get("/price-overrides/:id", adminPriceOverrideController.getOverrideById);
router.post("/price-overrides", adminPriceOverrideController.createOverride);
router.put("/price-overrides/:id", adminPriceOverrideController.updateOverride);
router.delete("/price-overrides/:id", adminPriceOverrideController.deleteOverride);
router.post("/price-overrides/bulk", adminPriceOverrideController.bulkCreate);

// A-10: Admin Chat
router.get("/chat/config", adminChatController.getChatConfig);
router.put("/chat/config", adminChatController.replaceChatConfig);
router.patch("/chat/config", adminChatController.patchChatConfig);
router.post("/chat/message", adminChatController.sendChatMessage);
router.get("/chat/conversations", adminChatController.listSupportConversations);
router.get("/chat/conversations/:id", adminChatController.getSupportConversation);
router.post("/chat/conversations/:id/message", adminChatController.replySupportConversation);
router.patch("/chat/conversations/:id/status", adminChatController.updateSupportConversationStatus);

module.exports = router;