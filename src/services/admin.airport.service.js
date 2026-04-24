const pool = require("../config/db");
const Q    = require("../queries/airport.queries");

// ─── Helpers ──────────────────────────────────────────────────────────────────

const validateAirportInput = (data, isUpdate = false) => {
  const { code, name, city } = data;

  if (!isUpdate) {
    if (!code) throw new Error("code là bắt buộc (VD: HAN, SGN)");
    if (!name) throw new Error("name là bắt buộc");
    if (!city) throw new Error("city là bắt buộc");
  }

  if (code && (code.length < 2 || code.length > 10)) {
    throw new Error("code phải từ 2-10 ký tự");
  }
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Xem danh sách sân bay (có filter + phân trang)
 */
const getAirports = async (params) => {
  const {
    page     = 1,
    limit    = 20,
    country,
    city,
    code,
    is_active,
  } = params;

  const offset     = (parseInt(page) - 1) * parseInt(limit);
  const conditions = [];
  const values     = [];
  let   idx        = 1;

  if (country)   { conditions.push(`LOWER(country) LIKE LOWER($${idx++})`); values.push(`%${country}%`); }
  if (city)      { conditions.push(`LOWER(city) LIKE LOWER($${idx++})`);    values.push(`%${city}%`); }
  if (code)      { conditions.push(`code ILIKE $${idx++}`);                 values.push(`%${code}%`); }
  if (is_active !== undefined && is_active !== "") {
    conditions.push(`is_active = $${idx++}`);
    values.push(is_active === "true" || is_active === true);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(Q.COUNT_AIRPORTS(whereClause), values);
  const total       = parseInt(countResult.rows[0].count);

  const dataResult = await pool.query(
    Q.SELECT_AIRPORTS(whereClause, idx, idx + 1),
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
 * Thêm sân bay mới
 */
const createAirport = async (data) => {
  validateAirportInput(data);

  const {
    code, name, city,
    country  = "Vietnam",
    timezone = "Asia/Ho_Chi_Minh",
  } = data;

  const existing = await pool.query(Q.FIND_AIRPORT_BY_CODE, [code]);
  if (existing.rows.length > 0) {
    throw new Error(`Sân bay với code "${code.toUpperCase()}" đã tồn tại`);
  }

  const result = await pool.query(Q.INSERT_AIRPORT, [code, name, city, country, timezone]);
  return result.rows[0];
};

/**
 * Cập nhật thông tin sân bay
 */
const updateAirport = async (airportId, data) => {
  validateAirportInput(data, true);

  const existing = await pool.query(Q.FIND_AIRPORT_BY_ID, [airportId]);
  if (existing.rows.length === 0) throw new Error("Không tìm thấy sân bay");

  const { name, city, country, timezone } = data;

  const fields = [];
  const values = [];
  let   idx    = 1;

  if (name)     { fields.push(`name=$${idx++}`);     values.push(name); }
  if (city)     { fields.push(`city=$${idx++}`);     values.push(city); }
  if (country)  { fields.push(`country=$${idx++}`);  values.push(country); }
  if (timezone) { fields.push(`timezone=$${idx++}`); values.push(timezone); }

  if (fields.length === 0) throw new Error("Không có thông tin nào để cập nhật");

  values.push(airportId);
  const result = await pool.query(Q.UPDATE_AIRPORT_FIELDS(fields, idx), values);
  return result.rows[0];
};

/**
 * Chuyển trạng thái sân bay (active ↔ inactive)
 */
const updateAirportStatus = async (airportId, is_active) => {
  if (typeof is_active !== "boolean" && is_active !== "true" && is_active !== "false") {
    throw new Error("is_active phải là true hoặc false");
  }

  const status = is_active === true || is_active === "true";

  const result = await pool.query(Q.UPDATE_AIRPORT_STATUS, [status, airportId]);

  if (result.rows.length === 0) throw new Error("Không tìm thấy sân bay");

  return {
    message: status ? "Đã kích hoạt sân bay" : "Đã vô hiệu hóa sân bay",
    airport: result.rows[0],
  };
};

module.exports = { getAirports, createAirport, updateAirport, updateAirportStatus };
