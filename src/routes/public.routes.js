const express = require("express");
const router = express.Router();

const flightController = require("../controllers/flight.controller");
const couponController = require("../controllers/coupon.controller");
const { sendContactEmail } = require("../utils/mailer");
const pool = require("../config/db");

router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
router.get("/airport-countries", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT country FROM airports WHERE country IS NOT NULL ORDER BY country`
  );
  res.json({ data: rows.map(r => r.country) });
});
router.get("/coupons", couponController.getCoupons);
router.get("/coupons/available", couponController.getAvailableCoupons);

router.post("/contact", async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "Vui lòng điền đầy đủ họ tên, email và nội dung." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Email không hợp lệ." });
  }
  const ok = await sendContactEmail({ name: name.trim(), email: email.trim(), subject: subject?.trim() || "", message: message.trim() });
  if (!ok) return res.status(500).json({ error: "Không thể gửi tin nhắn. Vui lòng thử lại sau." });
  res.json({ success: true });
});

module.exports = router;
