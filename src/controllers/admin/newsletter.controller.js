/*
============================================================
ADMIN NEWSLETTER CONTROLLER
============================================================
Trang Newsletter bên admin gọi 2 endpoint này. Trước đây chúng
chưa tồn tại (chỉ có /newsletter/subscribe và /unsubscribe cho khách)
nên danh sách luôn rỗng và nút gửi luôn báo lỗi.
============================================================
*/

const pool = require("../../config/db");
const { sendNewsletterBroadcast } = require("../../utils/mailer");

// GET /api/admin/newsletter/subscribers
const getSubscribers = async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, is_active, created_at
       FROM newsletter_subscribers
       ORDER BY created_at DESC`
    );
    res.json({ data: result.rows });
  } catch (err) {
    console.error("[Admin Newsletter] list error:", err.message);
    res.status(500).json({ error: "Không thể tải danh sách subscriber" });
  }
};

// POST /api/admin/newsletter/send  { subject, title, body, ctaText, ctaUrl }
const sendBroadcast = async (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const title   = String(req.body.title   || "").trim();
  const body    = String(req.body.body    || "").trim();

  if (!subject || !title || !body) {
    return res.status(400).json({ error: "Thiếu subject, title hoặc nội dung" });
  }

  try {
    const { rows: subscribers } = await pool.query(
      `SELECT email, unsubscribe_token
       FROM newsletter_subscribers
       WHERE is_active = TRUE`
    );

    if (subscribers.length === 0) {
      return res.status(400).json({ error: "Chưa có subscriber nào đang active" });
    }

    const result = await sendNewsletterBroadcast(subscribers, {
      subject,
      title,
      body,
      ctaText: String(req.body.ctaText || "").trim(),
      ctaUrl:  String(req.body.ctaUrl  || "").trim(),
    });

    // sendNewsletterBroadcast trả { sent, failed }; total để admin đối chiếu
    res.json({
      total:  subscribers.length,
      sent:   result?.sent   ?? 0,
      failed: result?.failed ?? 0,
    });
  } catch (err) {
    console.error("[Admin Newsletter] send error:", err.message);
    res.status(500).json({ error: "Không thể gửi newsletter" });
  }
};

module.exports = { getSubscribers, sendBroadcast };
