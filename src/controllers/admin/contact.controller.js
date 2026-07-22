/*
============================================================
ADMIN CONTACT CONTROLLER — Hộp thư phản hồi
============================================================
Tin nhắn từ form Contact ở trang khách được lưu vào contact_messages.
Admin xem danh sách, đánh dấu đã đọc và soạn email trả lời cho khách.
============================================================
*/

const pool = require("../../config/db");
const { sendContactReplyEmail } = require("../../utils/mailer");

const STATUSES = ["new", "read", "replied"];

// GET /api/admin/contact-messages?status=&page=&limit=
const getMessages = async (req, res) => {
  try {
    const page   = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit  = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 20));
    const offset = (page - 1) * limit;

    const conditions = [];
    const values     = [];
    if (STATUSES.includes(req.query.status)) {
      conditions.push(`status = $${values.length + 1}`);
      values.push(req.query.status);
    }
    const dk = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [countResult, dataResult, statsResult] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total FROM contact_messages ${dk}`, values),
      pool.query(
        `SELECT id, name, email, subject, message, status,
                reply_body, replied_at, created_at
         FROM contact_messages ${dk}
         ORDER BY created_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset]
      ),
      pool.query(
        `SELECT
           COUNT(*)                                  AS total,
           COUNT(*) FILTER (WHERE status = 'new')     AS new_count,
           COUNT(*) FILTER (WHERE status = 'replied') AS replied_count
         FROM contact_messages`
      ),
    ]);

    const total = parseInt(countResult.rows[0].total, 10) || 0;
    const s     = statsResult.rows[0] || {};

    res.json({
      data: dataResult.rows,
      pagination: { total, page, limit, total_pages: Math.max(1, Math.ceil(total / limit)) },
      stats: {
        total:   parseInt(s.total, 10)         || 0,
        new:     parseInt(s.new_count, 10)     || 0,
        replied: parseInt(s.replied_count, 10) || 0,
      },
    });
  } catch (err) {
    console.error("[Admin Contact] list error:", err.message);
    res.status(500).json({ error: "Không thể tải danh sách tin nhắn" });
  }
};

// PATCH /api/admin/contact-messages/:id/status  { status }
const updateStatus = async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    return res.status(400).json({ error: `status phải là một trong: ${STATUSES.join(", ")}` });
  }
  try {
    const result = await pool.query(
      `UPDATE contact_messages SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING id, status`,
      [status, req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });
    res.json({ data: result.rows[0] });
  } catch (err) {
    console.error("[Admin Contact] update status error:", err.message);
    res.status(500).json({ error: "Không thể cập nhật trạng thái" });
  }
};

// POST /api/admin/contact-messages/:id/reply  { reply }
const replyMessage = async (req, res) => {
  const reply = String(req.body.reply || "").trim();
  if (!reply) return res.status(400).json({ error: "Nội dung trả lời không được để trống" });

  try {
    const found = await pool.query(
      `SELECT id, name, email, subject, message FROM contact_messages WHERE id = $1`,
      [req.params.id]
    );
    if (found.rows.length === 0) return res.status(404).json({ error: "Không tìm thấy tin nhắn" });

    const msg = found.rows[0];
    const ok  = await sendContactReplyEmail(msg.email, {
      name:            msg.name,
      originalSubject: msg.subject,
      originalMessage: msg.message,
      replyBody:       reply,
    });

    // Chỉ đánh dấu 'replied' khi email thật sự gửi được — nếu không admin sẽ
    // tưởng đã trả lời xong trong khi khách chưa nhận được gì.
    if (!ok) return res.status(502).json({ error: "Không gửi được email trả lời. Vui lòng thử lại." });

    await pool.query(
      `UPDATE contact_messages
       SET status = 'replied', reply_body = $1, replied_at = NOW(), replied_by = $2, updated_at = NOW()
       WHERE id = $3`,
      [reply, req.user?.id || null, msg.id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("[Admin Contact] reply error:", err.message);
    res.status(500).json({ error: "Không thể gửi trả lời" });
  }
};

module.exports = { getMessages, updateStatus, replyMessage };
