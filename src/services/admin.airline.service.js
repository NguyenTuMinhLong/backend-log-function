const pool = require("../config/db");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validateAirlineInput = (data, isUpdate = false) => {
  const { code, name } = data;

  if (!isUpdate) {
    if (!code) throw new Error("code là bắt buộc (VD: VN, VJ, SQ)");
    if (!name) throw new Error("name là bắt buộc");
  }

  if (code && (code.length < 2 || code.length > 10)) {
    throw new Error("code phải từ 2-10 ký tự");
  }
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Xem danh sách hãng bay (có filter + phân trang)
 */
const getAirlines = async (params) => {
  const {
    page      = 1,
    limit     = 20,
    code,
    name,
    is_active,
  } = params;

  const offset     = (parseInt(page) - 1) * parseInt(limit);
  const conditions = [];
  const values     = [];
  let   idx        = 1;

  if (code) { conditions.push(`code ILIKE $${idx++}`);               values.push(`%${code}%`); }
  if (name) { conditions.push(`LOWER(name) LIKE LOWER($${idx++})`);  values.push(`%${name}%`); }
  if (is_active !== undefined && is_active !== "") {
    conditions.push(`is_active = $${idx++}`);
    values.push(is_active === "true" || is_active === true);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM airlines ${whereClause}`, values
  );
  const total = parseInt(countResult.rows[0].count);

  const dataResult = await pool.query(
    `SELECT id, code, name, logo_url, is_active, created_at
     FROM airlines
     ${whereClause}
     ORDER BY name ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, parseInt(limit), offset]
  );

  return {
    data: dataResult.rows,
    pagination: {
      total,
      page:        parseInt(page),
      limit:       parseInt(limit),
      total_pages: Math.ceil(total / parseInt(limit)),
    },
  };
};

/**
 * Thêm hãng hàng không mới
 */
const createAirline = async (data) => {
  validateAirlineInput(data);

  const { code, name, logo_url } = data;

  // Kiểm tra code đã tồn tại chưa
  const existing = await pool.query(
    "SELECT id FROM airlines WHERE UPPER(code) = UPPER($1)", [code]
  );
  if (existing.rows.length > 0) {
    throw new Error(`Hãng bay với code "${code.toUpperCase()}" đã tồn tại`);
  }

  const result = await pool.query(
    `INSERT INTO airlines (code, name, logo_url)
     VALUES (UPPER($1), $2, $3)
     RETURNING *`,
    [code, name, logo_url || null]
  );

  return result.rows[0];
};

/**
 * Cập nhật thông tin hãng bay
 */
const updateAirline = async (airlineId, data) => {
  validateAirlineInput(data, true);

  const existing = await pool.query(
    "SELECT id FROM airlines WHERE id=$1", [airlineId]
  );
  if (existing.rows.length === 0) throw new Error("Không tìm thấy hãng hàng không");

  const { name, logo_url } = data;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (name     !== undefined) { fields.push(`name=$${idx++}`);     values.push(name); }
  if (logo_url !== undefined) { fields.push(`logo_url=$${idx++}`); values.push(logo_url); }

  if (fields.length === 0) throw new Error("Không có thông tin nào để cập nhật");

  values.push(airlineId);
  const result = await pool.query(
    `UPDATE airlines SET ${fields.join(", ")} WHERE id=$${idx} RETURNING *`,
    values
  );

  return result.rows[0];
};

/**
 * Chuyển trạng thái hãng bay (active ↔ inactive)
 */
const updateAirlineStatus = async (airlineId, is_active) => {
  if (typeof is_active !== "boolean" && is_active !== "true" && is_active !== "false") {
    throw new Error("is_active phải là true hoặc false");
  }

  const status = is_active === true || is_active === "true";

  const result = await pool.query(
    `UPDATE airlines SET is_active=$1 WHERE id=$2
     RETURNING id, code, name, is_active`,
    [status, airlineId]
  );

  if (result.rows.length === 0) throw new Error("Không tìm thấy hãng hàng không");

  return {
    message: status ? "Đã kích hoạt hãng bay" : "Đã vô hiệu hóa hãng bay",
    airline: result.rows[0],
  };
};

module.exports = { getAirlines, createAirline, updateAirline, updateAirlineStatus };