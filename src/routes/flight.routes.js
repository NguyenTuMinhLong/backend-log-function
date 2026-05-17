const express = require("express");
const router = express.Router();
const flightController = require("../controllers/flight.controller");

router.get("/search",          flightController.searchFlights);
router.get("/airports",        flightController.getAirports);
router.get("/airlines",        flightController.getAirlines);
router.get("/alternatives",    flightController.getAlternativeFlights);
router.get("/price-calendar",  flightController.getPriceCalendar);
router.get("/:id/seat-map",    flightController.getSeatMap);
// router.get("/:id/position",    flightController.getFlightPosition); // lấy vị trí máy bay
router.get("/:id",             flightController.getFlightById);
router.get("/recommendations", flightController.getFlightRecommendations);

module.exports = router;