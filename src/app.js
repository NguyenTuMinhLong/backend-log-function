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
const { expireHeldBookings, autoCompleteFlights } = require("./services/booking.service");
const { autoGenerateFlights }  = require("./services/admin/flight.service");
const { checkAndAlertSLABreach } = require("./services/notification.service");
const { runBatch: autoFlightBatch } = require("./services/admin/auto-flight.service");
const pool = require("./config/db");
require("./scripts/Loyalty.cron");

// Migration: thêm cột country vào airlines nếu chưa có
pool.query(`ALTER TABLE airlines ADD COLUMN IF NOT EXISTS country VARCHAR(100)`)
  .then(() => console.log('[Migration] airlines.country OK'))
  .catch(err => console.error('[Migration] airlines.country:', err.message));

// Migration: thêm route_offset, route_limit và from-airport job columns
pool.query(`
  ALTER TABLE auto_flight_config
    ADD COLUMN IF NOT EXISTS route_offset         INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS route_limit          INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN IF NOT EXISTS ap_airport_code      VARCHAR(10),
    ADD COLUMN IF NOT EXISTS ap_start_date        DATE,
    ADD COLUMN IF NOT EXISTS ap_end_date          DATE,
    ADD COLUMN IF NOT EXISTS ap_flights_per_route INTEGER DEFAULT 2,
    ADD COLUMN IF NOT EXISTS ap_mode              VARCHAR(20) DEFAULT 'all_airlines',
    ADD COLUMN IF NOT EXISTS ap_running           BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ap_created           INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS ap_round             INTEGER NOT NULL DEFAULT 0
`)
  .then(() => console.log('[Migration] auto_flight_config columns OK'))
  .catch(err => console.error('[Migration] auto_flight_config:', err.message));

const app = express();

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS', 'HEAD'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
  credentials: true
}));
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
    await autoCompleteFlights();
  } catch (err) {
    console.error("[Auto-expire] Unhandled error:", err.message);
  } finally {
    isExpiringHeldBookings = false;
  }
}, 60 * 1000);

// A-12: Tự động sinh chuyến bay cho tất cả hãng (auto-flight config)
// Mỗi 30 phút — 5 phút quá dày, query existingRes quét hàng chục nghìn
// dòng flights mỗi lần chạy gây egress Supabase tăng vọt khi route_limit lớn.
let isAutoFlighting = false;
setInterval(async () => {
  if (isAutoFlighting) return;
  isAutoFlighting = true;
  try {
    await autoFlightBatch(200);      // tự động đa hãng
  } catch (err) {
    console.error("[AutoFlight] Unhandled error:", err.message);
  } finally {
    isAutoFlighting = false;
  }
}, 30 * 60 * 1000); // mỗi 30 phút

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