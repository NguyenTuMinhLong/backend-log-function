const express = require("express");
const router = express.Router();
const flightController = require("../controllers/flight.controller");

// Đặt /search, /airports, /airlines TRƯỚC /:id
// để Express không nhầm "search" là một :id param
router.get("/search",   flightController.searchFlights);
router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
router.get("/:id",      flightController.getFlightById);

module.exports = router;