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
router.post("/auto-flights/from-airport-bg", adminAutoFlightController.runFromAirportBg);
router.get("/auto-flights/bg-status",        adminAutoFlightController.getBgJobStatus);

// A-11: Cronjob Manual Trigger
router.post("/cron/run",              adminCronController.runCron);
router.post("/cron/expired-bookings", adminCronController.runExpiredBookings);
router.post("/loyalty/recalculate",   adminCronController.recalculateLoyalty);

// A-10: Admin Chat
router.get("/chat/config", adminChatController.getChatConfig);
router.put("/chat/config", adminChatController.replaceChatConfig);
router.patch("/chat/config", adminChatController.patchChatConfig);
router.post("/chat/message", adminChatController.sendChatMessage);
router.get("/chat/conversations", adminChatController.listSupportConversations);
router.get("/chat/conversations/:id", adminChatController.getSupportConversation);
router.post("/chat/conversations/:id/message", adminChatController.replySupportConversation);
router.patch("/chat/conversations/:id/status", adminChatController.updateSupportConversationStatus);

// ── Newsletter ────────────────────────────────────────────────────────────────
const { sendNewsletterBroadcast } = require('../utils/mailer');
const pool = require('../config/db');

router.get("/newsletter/subscribers", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, email, is_active, created_at FROM newsletter_subscribers ORDER BY created_at DESC`
    );
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/newsletter/send", async (req, res) => {
  const { subject, title, body, ctaText, ctaUrl } = req.body;
  if (!subject || !title || !body) {
    return res.status(400).json({ error: "Thiếu subject, title hoặc body" });
  }
  try {
    const { rows } = await pool.query(
      `SELECT email, unsubscribe_token FROM newsletter_subscribers WHERE is_active = TRUE`
    );
    if (rows.length === 0) return res.json({ sent: 0, failed: 0, message: "Không có subscriber nào" });
    const result = await sendNewsletterBroadcast(rows, { subject, title, body, ctaText, ctaUrl });
    res.json({ ...result, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
