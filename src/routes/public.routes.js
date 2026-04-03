const express = require("express");
const router = express.Router();

const flightController = require("../controllers/flight.controller");
const couponController = require("../controllers/coupon.controller");

router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
router.get("/coupons", couponController.getCoupons);
router.get("/coupons/available", couponController.getAvailableCoupons);

module.exports = router;
