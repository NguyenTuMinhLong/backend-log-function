const express = require("express");
const router  = express.Router();

const { authenticate, authorize } = require("../middlewares/auth.middleware");

const adminFlightController  = require("../controllers/admin.flight.controller");
const adminAirportController = require("../controllers/admin.airport.controller");
const adminAirlineController = require("../controllers/admin.airline.controller");

// Tất cả routes admin: phải đăng nhập + role = 'admin'
router.use(authenticate, authorize("admin"));

// ── A-01: Manage Flights ──────────────────────────────────────────────────────
router.get   ("/flights",                adminFlightController.getFlights);
router.post  ("/flights",                adminFlightController.createFlight);
router.put   ("/flights/:id",            adminFlightController.updateFlight);
router.patch ("/flights/:id/status",     adminFlightController.updateFlightStatus);
router.patch ("/flights/:id/visibility", adminFlightController.toggleFlightVisibility);

// ── A-02: Manage Airports ─────────────────────────────────────────────────────
router.get   ("/airports",           adminAirportController.getAirports);
router.post  ("/airports",           adminAirportController.createAirport);
router.put   ("/airports/:id",       adminAirportController.updateAirport);
router.patch ("/airports/:id/status",adminAirportController.updateAirportStatus);

// ── A-03: Manage Airlines ─────────────────────────────────────────────────────
router.get   ("/airlines",           adminAirlineController.getAirlines);
router.post  ("/airlines",           adminAirlineController.createAirline);
router.put   ("/airlines/:id",       adminAirlineController.updateAirline);
router.patch ("/airlines/:id/status",adminAirlineController.updateAirlineStatus);

module.exports = router;