const express = require("express");
const cors    = require("cors");

const authRoutes    = require("./routes/auth.routes");
const flightRoutes  = require("./routes/flight.routes");
const bookingRoutes = require("./routes/booking.routes");
const adminRoutes   = require("./routes/admin.routes");
const chatRoutes    = require("./routes/chat.routes");
const paymentRoutes  = require("./routes/payment.routes");
const publicRoutes   = require("./routes/public.routes");
const ancillaryRoutes  = require('./routes/ancillary.routes');
const wishlistRoutes = require("./routes/wishlist.routes");
const loyaltyRoutes = require('./routes/loyalty.routes');
const refundRoutes = require('./routes/refund.routes');
const dateChangeRoutes = require('./routes/date-change.routes');
const seatRoutes = require('./routes/seat.routes');
const checkinRoutes = require('./routes/checkin.routes');

const { expireHeldBookings }   = require("./services/booking.service");
const { autoGenerateFlights }  = require("./services/admin/flight.service");
const { checkAndAlertSLABreach } = require("./services/notification.service");
const { runBatch: autoFlightBatch } = require("./services/admin/auto-flight.service");
require("./scripts/Loyalty.cron"); // Loyalty annual reset cron job

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.use("/api/auth",     authRoutes);
app.use("/api",          publicRoutes);
app.use("/api/flights",  flightRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/chat",     chatRoutes);
app.use("/api/admin",    adminRoutes);
app.use("/api/payments", paymentRoutes);
app.use('/api/ancillaries', ancillaryRoutes);
app.use("/api/wishlist", wishlistRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/refunds', refundRoutes);
app.use('/api/date-changes', dateChangeRoutes);
app.use('/api', seatRoutes);
app.use('/api/checkin', checkinRoutes);

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

// A-12: Mỗi 5 phút tự động sinh chuyến bay cho tất cả hãng (auto-flight config)
let isAutoFlighting = false;
setInterval(async () => {
  if (isAutoFlighting) return;
  isAutoFlighting = true;
  try {
    await autoFlightBatch(200); // tạo tối đa 200 chuyến mỗi lần
  } catch (err) {
    console.error("[AutoFlight] Unhandled error:", err.message);
  } finally {
    isAutoFlighting = false;
  }
}, 5 * 60 * 1000); // mỗi 5 phút

// AD-04: Mỗi 24 giờ tự động sinh chuyến bay từ lịch bay định kỳ (flight_schedules)
let isGeneratingFlights = false;

setInterval(async () => {
  if (isGeneratingFlights) return;

  isGeneratingFlights = true;
  try {
    await autoGenerateFlights();
  } catch (err) {
    console.error("[AutoGenerate] Unhandled error:", err.message);
  } finally {
    isGeneratingFlights = false;
  }
}, 24 * 60 * 60 * 1000); // mỗi 24 giờ

module.exports = app;