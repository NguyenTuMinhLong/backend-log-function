const express = require("express");
const router = express.Router();
const flightController = require("../controllers/flight.controller");
const flightComboController = require("../controllers/flight-combo.controller");

router.get("/search",          flightController.searchFlights);
router.get("/mixed-search",     flightComboController.mixedSearch);
router.get("/airports",        flightController.getAirports);
router.get("/airlines",        flightController.getAirlines);
router.get("/alternatives",    flightController.getAlternativeFlights);
router.get("/combo",           flightController.getFlightCombos);
router.get("/price-calendar",  flightController.getPriceCalendar);
router.get("/recommendations", flightController.getFlightRecommendations);
router.get("/browse",          flightController.browseFlights);
router.get("/price-analysis",  flightController.getPriceAnalysis); // Price analysis endpoint
router.get("/:id/seat-map",    flightController.getSeatMap);
router.get("/:id/position",    flightController.getFlightPosition);
router.get("/:id/price-analysis", flightController.getFlightPriceAnalysis); // Flight-specific price analysis
router.get("/:id",             flightController.getFlightById);

module.exports = router;