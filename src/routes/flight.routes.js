const express = require("express");
const router = express.Router();
const flightController = require("../controllers/flight.controller");

router.get("/search",          flightController.searchFlights);
router.get("/airports",        flightController.getAirports);
router.get("/airlines",        flightController.getAirlines);
router.get("/alternatives",    flightController.getAlternativeFlights);
router.get("/price-calendar",  flightController.getPriceCalendar);
router.get("/:id/seat-map",    flightController.getSeatMap);
router.get("/:id",             flightController.getFlightById);

module.exports = router;