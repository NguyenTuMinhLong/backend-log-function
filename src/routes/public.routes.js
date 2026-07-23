const express = require("express");
const router = express.Router();

const flightController = require("../controllers/flight.controller");
const couponController = require("../controllers/coupon.controller");
const { authenticateOptional } = require("../middlewares/auth.middleware");
const { sendContactEmail } = require("../utils/mailer");
const pool = require("../config/db");

router.get("/airports", flightController.getAirports);
router.get("/airlines", flightController.getAirlines);
// Guest: kiểm tra email/phone có thuộc tài khoản nào không (guest không được dùng email/phone đã đăng ký)
router.post("/check-contact", async (req, res) => {
  try {
    const { email, phone } = req.body;
    const result = { email_taken: false, phone_taken: false };
    if (email) {
      const r = await pool.query(`SELECT id FROM users WHERE LOWER(email) = LOWER($1)`, [email]);
      result.email_taken = r.rows.length > 0;
    }
    if (phone) {
      const r = await pool.query(`SELECT id FROM users WHERE phone = $1`, [phone.replace(/\s/g, "")]);
      result.phone_taken = r.rows.length > 0;
    }
    res.json(result);
  } catch (err) {
    console.error("[check-contact] DB error:", err.message);
    res.status(500).json({ error: "Không thể kiểm tra thông tin liên hệ" });
  }
});

router.get("/airport-countries", async (req, res) => {
  const { rows } = await pool.query(
    `SELECT DISTINCT country FROM airports WHERE country IS NOT NULL ORDER BY country`
  );
  res.json({ data: rows.map(r => r.country) });
});
router.get("/coupons", couponController.getCoupons);
router.get("/coupons/available", authenticateOptional, couponController.getAvailableCoupons);

// Tin nhắn liên hệ được LƯU VÀO DB để admin đọc & trả lời ở trang "Mail phản hồi".
// Trước đây chỉ forward qua email cá nhân nên không tra cứu / theo dõi được.
router.post("/contact", async (req, res) => {
  const { name, email, subject, message } = req.body;
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ error: "Vui lòng điền đầy đủ họ tên, email và nội dung." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Email không hợp lệ." });
  }

  const payload = {
    name:    name.trim(),
    email:   email.trim(),
    subject: subject?.trim() || "",
    message: message.trim(),
  };

  try {
    await pool.query(
      `INSERT INTO contact_messages (name, email, subject, message)
       VALUES ($1, $2, $3, $4)`,
      [payload.name, payload.email, payload.subject || null, payload.message]
    );
  } catch (err) {
    console.error("[Contact] insert error:", err.message);
    return res.status(500).json({ error: "Không thể gửi tin nhắn. Vui lòng thử lại sau." });
  }

  // Vẫn báo email cho team support, nhưng không chặn phản hồi cho khách:
  // tin nhắn đã nằm trong DB, admin đọc được kể cả khi email lỗi.
  sendContactEmail(payload).catch(() => {});

  res.json({ success: true });
});

// Đăng ký nhận khuyến mãi qua email
router.post("/newsletter/subscribe", async (req, res) => {
  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: "Email không hợp lệ" });
  }
  try {
    const crypto = require('crypto');
    const token = crypto.randomBytes(32).toString('hex');
    await pool.query(
      `INSERT INTO newsletter_subscribers (email, unsubscribe_token)
       VALUES (LOWER($1), $2)
       ON CONFLICT (email) DO UPDATE
         SET is_active = TRUE`,
      [email.trim(), token]
    );
    // Gửi welcome email bất đồng bộ
    try {
      const { sendNewsletterWelcomeEmail } = require('../utils/mailer');
      sendNewsletterWelcomeEmail(email.trim(), { unsubscribeToken: token }).catch(() => {});
    } catch (_) {}
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
