const express = require("express");
const router = express.Router();

const { authenticate, authorize } = require("../middlewares/auth.middleware");

const adminFlightController = require("../controllers/admin.flight.controller");
const adminAirportController = require("../controllers/admin.airport.controller");
const adminAirlineController = require("../controllers/admin.airline.controller");
const adminCouponController = require("../controllers/admin.coupon.controller");

const adminUserController = require("../controllers/admin.user.controller");

// Tất cả routes admin: phải đăng nhập + role = 'admin'
router.use(authenticate, authorize("admin"));

// A-01: Manage Flights
router.get("/flights", adminFlightController.getFlights);
router.post("/flights", adminFlightController.createFlight);
router.put("/flights/:id", adminFlightController.updateFlight);
router.patch("/flights/:id/status", adminFlightController.updateFlightStatus);
router.patch("/flights/:id/visibility", adminFlightController.toggleFlightVisibility);

// A-02: Manage Airports
router.get("/airports", adminAirportController.getAirports);
router.post("/airports", adminAirportController.createAirport);
router.put("/airports/:id", adminAirportController.updateAirport);
router.patch("/airports/:id/status", adminAirportController.updateAirportStatus);

// A-03: Manage Airlines
router.get("/airlines", adminAirlineController.getAirlines);
router.post("/airlines", adminAirlineController.createAirline);
router.put("/airlines/:id", adminAirlineController.updateAirline);
router.patch("/airlines/:id/status", adminAirlineController.updateAirlineStatus);

// A-04: Manage Users
router.get("/users", adminUserController.getUsers);
router.get("/users/:id", adminUserController.getUserById);
router.patch("/users/:id/status", adminUserController.updateUserStatus);
router.patch("/users/:id/role", adminUserController.updateUserRole);

// A-05: Manage Coupons
router.get("/coupons", adminCouponController.getCoupons);
router.get("/coupons/:id", adminCouponController.getCouponById);
router.post("/coupons", adminCouponController.createCoupon);
router.put("/coupons/:id", adminCouponController.updateCoupon);
router.patch("/coupons/:id/status", adminCouponController.updateCouponStatus);
router.delete("/coupons/:id", adminCouponController.deleteCoupon);

// A-06: Manage Bookings
router.get("/bookings", adminFlightController.getBookings);
router.get("/bookings/:id", adminFlightController.getBookingDetailAdmin);
router.patch("/bookings/:id/status", adminFlightController.updateBookingStatus);

// A-07: Reports / Statistics
router.get("/statistics", adminFlightController.getStatistics);

module.exports = router;
