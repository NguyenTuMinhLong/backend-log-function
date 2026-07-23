const express = require("express");
const router = express.Router();
const { authenticateOptional } = require("../middlewares/auth.middleware");
const flightController = require("../controllers/flight.controller");
const flightComboController = require("../controllers/flight-combo.controller");
const flightBrandController = require("../controllers/flight-brand.controller");

router.get("/search",          authenticateOptional, flightController.searchFlights);
router.get("/mixed-search",     flightComboController.mixedSearch);
router.get("/airports",        flightController.getAirports);
router.get("/airlines",        flightController.getAirlines);
router.get("/alternatives",    flightController.getAlternativeFlights);
router.get("/combo",           flightController.getFlightCombos);
router.get("/price-calendar",  flightController.getPriceCalendar);
router.get("/recommendations", authenticateOptional, flightController.getFlightRecommendations);
router.get("/brand-combinations",   flightBrandController.getBrandCombinations);
router.get("/browse",               flightController.browseFlights);
router.get("/by-airline/:code",     flightController.getFlightsByAirline);
router.get("/price-analysis",  flightController.getPriceAnalysis);
router.get("/:id/seat-map",    flightController.getSeatMap);
router.get("/:id/position",    flightController.getFlightPosition);
router.get("/:id/price-analysis", flightController.getFlightPriceAnalysis); // Flight-specific price analysis
router.get("/:id",             flightController.getFlightById);

module.exports = router;
