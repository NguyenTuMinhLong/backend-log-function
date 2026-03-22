const express = require("express");
const cors    = require("cors");

const authRoutes    = require("./routes/auth.routes");
const flightRoutes  = require("./routes/flight.routes");
const bookingRoutes = require("./routes/booking.routes");

const { expireHeldBookings } = require("./services/booking.service");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth",     authRoutes);
app.use("/api/flights",  flightRoutes);
app.use("/api/bookings", bookingRoutes);

// Tự động hủy booking hết hạn giữ ghế mỗi 1 phút
setInterval(expireHeldBookings, 60 * 1000);

module.exports = app;