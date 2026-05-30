const express = require("express");
const router = express.Router();

const flightController = require("../controllers/flight.controller");
const couponController = require("../controllers/coupon.controller");
const { sendContactEmail } = require("../utils/mailer");
const pool = require("../config/db");

router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
// Guest: kiểm tra email/phone có thuộc tài khoản nào không (guest không được dùng email/phone đã đăng ký)
router.post("/check-contact", async (req, res) => {
  const { email, phone } = req.body;
  const result = { email_taken: false, phone_taken: false };
  if (email) {
    const r = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
    result.email_taken = r.rows.length > 0;
  }
  if (phone) {
    const r = await pool.query(`SELECT id FROM users WHERE phone = $1`, [phone.replace(/\s/g,'')]);
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

// Đăng ký nhận khuyến mãi qua email
const crypto = require('crypto');
const { sendNewsletterWelcomeEmail } = require('../utils/mailer');

router.post("/newsletter/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Email không hợp lệ" });
  }
  try {
    const token = crypto.randomBytes(32).toString('hex');
    const result = await pool.query(
      `INSERT INTO newsletter_subscribers (email, unsubscribe_token)
       VALUES (LOWER($1), $2)
       ON CONFLICT (email) DO UPDATE
         SET is_active = TRUE,
             unsubscribe_token = COALESCE(newsletter_subscribers.unsubscribe_token, EXCLUDED.unsubscribe_token)
       RETURNING unsubscribe_token, (xmax = 0) AS is_new`,
      [email.trim(), token]
    );
    const isNew = result.rows[0]?.is_new;
    const finalToken = result.rows[0]?.unsubscribe_token;
    // Chỉ gửi welcome email khi lần đầu đăng ký
    if (isNew) {
      sendNewsletterWelcomeEmail(email.trim(), { unsubscribeToken: finalToken }).catch(() => {});
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[Newsletter] subscribe error:", err.message);
    res.status(500).json({ error: "Lỗi server" });
  }
});

// Hủy đăng ký qua token
router.get("/newsletter/unsubscribe", async (req, res) => {
  const { token } = req.query;
  if (!token) return res.status(400).json({ error: "Token không hợp lệ" });
  try {
    const result = await pool.query(
      `UPDATE newsletter_subscribers SET is_active = FALSE WHERE unsubscribe_token = $1 RETURNING email`,
      [token]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Token không tồn tại" });
    res.json({ success: true, email: result.rows[0].email });
  } catch (err) {
    console.error("[Newsletter] unsubscribe error:", err.message);
    res.status(500).json({ error: "Lỗi server" });
  }
});

module.exports = router;
