const express = require("express");
const router = express.Router();

const flightController = require("../controllers/flight.controller");
const couponController = require("../controllers/coupon.controller");
const { sendContactEmail } = require("../utils/mailer");
const pool = require("../config/db");

router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
// Kiểm tra email/phone có thuộc tài khoản đã đăng ký của người khác không
router.post("/check-contact", async (req, res) => {
  const { email, phone, userId } = req.body;
  const uid = parseInt(userId) || 0;
  const result = { email_taken: false, phone_taken: false };
  if (email) {
    const r = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1) AND id != $2`, [email, uid]);
    result.email_taken = r.rows.length > 0;
  }
  if (phone) {
    const r = await pool.query(`SELECT id FROM users WHERE phone = $1 AND id != $2`, [phone.replace(/\s/g,''), uid]);
    result.phone_taken = r.rows.length > 0;
  }
  res.json(result);
});

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
