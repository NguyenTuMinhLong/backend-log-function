const express = require("express");
const router = express.Router();
const { authenticateOptional } = require("../middlewares/auth.middleware");
const flightController = require("../controllers/flight.controller");
const flightBrandController = require("../controllers/flight-brand.controller");

router.get("/search", authenticateOptional, flightController.searchFlights);
// router.get("/search", flightController.searchFlights);
router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
router.get("/alternatives", flightController.getAlternativeFlights);
router.get("/price-calendar", flightController.getPriceCalendar);
router.get("/recommendations", authenticateOptional,flightController.getFlightRecommendations);
router.get("/brand-combinations", flightBrandController.getBrandCombinations);
router.get("/:id/seat-map", flightController.getSeatMap);
router.get("/:id/position", flightController.getFlightPosition);
router.get("/:id", flightController.getFlightById);

module.exports = router;
