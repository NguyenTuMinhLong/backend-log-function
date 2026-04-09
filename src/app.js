const express = require("express");
const cors    = require("cors");

const authRoutes    = require("./routes/auth.routes");
const flightRoutes  = require("./routes/flight.routes");
const bookingRoutes = require("./routes/booking.routes");
const adminRoutes   = require("./routes/admin.routes");
const chatRoutes    = require("./routes/chat.routes");
const paymentRoutes = require("./routes/payment.routes");
const publicRoutes  = require("./routes/public.routes");

const { expireHeldBookings } = require("./services/booking.service");

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth",     authRoutes);
app.use("/api",          publicRoutes);
app.use("/api/flights",  flightRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/chat",     chatRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/payments", paymentRoutes);

// Mỗi 1 phút sẽ chạy 1 lần để kiểm tra toàn bộ danh sách booking nhằm tự động hủy booking đã hết hạn giữ ghế
// 5. Thời gian giữ ghế (30 phút) nằm bên service dòng 192
let isExpiringHeldBookings = false;

setInterval(async () => {
  if (isExpiringHeldBookings) {
    return;
  }

  isExpiringHeldBookings = true;

  try {
    await expireHeldBookings();
  } catch (err) {
    console.error("[Auto-expire] Unhandled error:", err.message);
  } finally {
    isExpiringHeldBookings = false;
  }
}, 60 * 1000);

module.exports = app;
