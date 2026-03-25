const express = require("express");
const router  = express.Router();

const { authenticate, authorize } = require("../middlewares/auth.middleware");
const adminFlightController = require("../controllers/admin.flight.controller");

// Tất cả routes admin đều phải: đăng nhập + role = 'admin'
router.use(authenticate, authorize("admin"));

// ── A-01: Manage Flights ──────────────────────────────────────────────────────
router.get   ("/flights",                adminFlightController.getFlights);
router.post  ("/flights",                adminFlightController.createFlight);
router.put   ("/flights/:id",            adminFlightController.updateFlight);
router.patch ("/flights/:id/status",     adminFlightController.updateFlightStatus);
router.patch ("/flights/:id/visibility", adminFlightController.toggleFlightVisibility);

module.exports = router;