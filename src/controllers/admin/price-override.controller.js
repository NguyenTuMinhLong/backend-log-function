const pool = require("../../config/db");
const { clearOverrideCache } = require("../../services/season.service");

const getOverrides = async (req, res) => {
  try {
    const { month, year, active } = req.query;
    let query = `
      SELECT po.*, u.email as created_by_email 
      FROM price_overrides po
      LEFT JOIN users u ON po.created_by = u.id
      WHERE 1=1
    `;
    const params = [];

    if (month) {
      params.push(month);
      query += ` AND EXTRACT(MONTH FROM po.date) = $${params.length}`;
    }
    if (year) {
      params.push(year);
      query += ` AND EXTRACT(YEAR FROM po.date) = $${params.length}`;
    }
    if (active !== undefined) {
      params.push(active === "true");
      query += ` AND po.is_active = $${params.length}`;
    }

    query += " ORDER BY po.date ASC";

    const { rows } = await pool.query(query, params);
    res.json({ data: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getOverrideById = async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT po.*, u.email as created_by_email 
       FROM price_overrides po
       LEFT JOIN users u ON po.created_by = u.id
       WHERE po.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy override" });
    }
    res.json({ data: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const createOverride = async (req, res) => {
  try {
    const { date, multiplier, reason, is_active = true } = req.body;

    if (!date || !multiplier) {
      return res.status(400).json({ error: "date và multiplier là bắt buộc" });
    }

    const multiplierNum = parseFloat(multiplier);
    if (isNaN(multiplierNum) || multiplierNum <= 0) {
      return res.status(400).json({ error: "multiplier phải > 0" });
    }

    const { rows } = await pool.query(
      `INSERT INTO price_overrides (date, multiplier, reason, is_active, created_by)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [date, multiplierNum, reason, is_active, req.user.id]
    );

    res.status(201).json({
      message: "Tạo override thành công",
      data: rows[0],
    });
    clearOverrideCache();
  } catch (err) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "Ngày này đã có override active" });
    }
    res.status(500).json({ error: err.message });
  }
};

const updateOverride = async (req, res) => {
  try {
    const { multiplier, reason, is_active } = req.body;
    const fields = [];
    const values = [];
    let paramCount = 0;

    if (multiplier !== undefined) {
      const multiplierNum = parseFloat(multiplier);
      if (isNaN(multiplierNum) || multiplierNum <= 0) {
        return res.status(400).json({ error: "multiplier phải > 0" });
      }
      paramCount++;
      fields.push(`multiplier = $${paramCount}`);
      values.push(multiplierNum);
    }
    if (reason !== undefined) {
      paramCount++;
      fields.push(`reason = $${paramCount}`);
      values.push(reason);
    }
    if (is_active !== undefined) {
      paramCount++;
      fields.push(`is_active = $${paramCount}`);
      values.push(is_active);
    }

    if (fields.length === 0) {
      return res.status(400).json({ error: "Không có trường nào để cập nhật" });
    }

    paramCount++;
    values.push(req.params.id);
    fields.push(`updated_at = NOW()`);

    const { rows } = await pool.query(
      `UPDATE price_overrides SET ${fields.join(", ")} WHERE id = $${paramCount} RETURNING *`,
      values
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy override" });
    }

    res.json({ message: "Cập nhật thành công", data: rows[0] });
    clearOverrideCache();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteOverride = async (req, res) => {
  try {
    const { rows } = await pool.query(
      "DELETE FROM price_overrides WHERE id = $1 RETURNING id",
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Không tìm thấy override" });
    }
    res.json({ message: "Xóa override thành công" });
    clearOverrideCache();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const bulkCreate = async (req, res) => {
  try {
    const { overrides } = req.body;

    if (!Array.isArray(overrides) || overrides.length === 0) {
      return res.status(400).json({ error: "overrides phải là mảng không rỗng" });
    }

    const results = [];
    const errors = [];

    for (const item of overrides) {
      const { date, multiplier, reason } = item;

      if (!date || !multiplier) {
        errors.push({ date, error: "Thiếu date hoặc multiplier" });
        continue;
      }

      const multiplierNum = parseFloat(multiplier);
      if (isNaN(multiplierNum) || multiplierNum <= 0) {
        errors.push({ date, error: "multiplier không hợp lệ" });
        continue;
      }

      try {
        const { rows } = await pool.query(
          `INSERT INTO price_overrides (date, multiplier, reason, created_by)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT ON CONSTRAINT idx_price_overrides_date_active
           DO UPDATE SET multiplier = EXCLUDED.multiplier, reason = EXCLUDED.reason, updated_at = NOW()
           RETURNING *`,
          [date, multiplierNum, reason, req.user.id]
        );
        results.push(rows[0]);
      } catch (err) {
        errors.push({ date, error: err.message });
      }
    }

    res.status(201).json({
      message: `Tạo ${results.length}/${overrides.length} overrides`,
      created: results.length,
      failed: errors.length,
      data: results,
      errors: errors.length > 0 ? errors : undefined,
    });
    clearOverrideCache();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getOverrides,
  getOverrideById,
  createOverride,
  updateOverride,
  deleteOverride,
  bulkCreate,
};
