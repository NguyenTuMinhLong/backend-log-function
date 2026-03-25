const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../middlewares/auth.middleware");
const c = require("../controllers/admin.flight.controller");

// Tất cả routes admin: phải đăng nhập + role = 'admin'
router.use(authenticate, authorize("admin"));

// ── A-01: Manage Flights ──────────────────────────────────────────────────────
router.get   ("/flights",                c.getFlights);
router.post  ("/flights",                c.createFlight);
router.put   ("/flights/:id",            c.updateFlight);
router.patch ("/flights/:id/status",     c.updateFlightStatus);
router.patch ("/flights/:id/visibility", c.toggleFlightVisibility);


// WARNING : CẦN fIX MẤY CÁI NÀY CHƯA CÓ
// // ── A-02: Manage Airports ─────────────────────────────────────────────────────
// router.get   ("/airports",             c.getAirports);
// router.post  ("/airports",             c.createAirport);
// router.put   ("/airports/:id",         c.updateAirport);
// router.patch ("/airports/:id/status",  c.toggleAirportStatus);

// // ── A-03: Manage Airlines ─────────────────────────────────────────────────────
// router.get   ("/airlines",             c.getAirlines);
// router.post  ("/airlines",             c.createAirline);
// router.put   ("/airlines/:id",         c.updateAirline);
// router.patch ("/airlines/:id/status",  c.toggleAirlineStatus);

// // ── A-06: Manage Bookings ─────────────────────────────────────────────────────
// router.get   ("/bookings",             c.getBookings);
// router.get   ("/bookings/:id",         c.getBookingDetail);
// router.patch ("/bookings/:id/status",  c.updateBookingStatus);

// // ── A-07: Reports / Statistics ────────────────────────────────────────────────
// router.get   ("/statistics",           c.getStatistics);

module.exports = router;