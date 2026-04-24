const pool = require("../config/db");
const Q    = require("../queries/coupon.queries");

const VALID_TYPES = ["fixed", "percent"];

const parseOptionalNumber = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${fieldName} không hợp lệ`);
  return parsed;
};

const parseOptionalInteger = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`${fieldName} phải là số nguyên`);
  return parsed;
};

const parseOptionalBoolean = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value;
  if (value === "true")  return true;
  if (value === "false") return false;
  throw new Error(`${fieldName} phải là true hoặc false`);
};

const parseOptionalDate = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${fieldName} không hợp lệ`);
  return date.toISOString();
};

const normalizeCode = (code) => {
  if (!code || typeof code !== "string") throw new Error("code là bắt buộc");
  const normalized = code.trim().toUpperCase();
  if (!/^[A-Z0-9_-]{3,50}$/.test(normalized)) {
    throw new Error("code chỉ được gồm chữ, số, dấu gạch dưới hoặc gạch ngang và dài 3-50 ký tự");
  }
  return normalized;
};

const sanitizeCoupon = (row) => ({
  id:                   row.id,
  airline_id:           row.airline_id,
  airline_code:         row.airline_code || null,
  airline_name:         row.airline_name || null,
  code:                 row.code,
  name:                 row.name,
  description:          row.description,
  type:                 row.type,
  value:                row.value !== null ? Number(row.value) : null,
  min_order:            row.min_order !== null ? Number(row.min_order) : null,
  max_discount:         row.max_discount !== null ? Number(row.max_discount) : null,
  start_at:             row.start_at,
  expiry_at:            row.expiry_at,
  usage_limit:          row.usage_limit,
  used_count:           row.used_count,
  usage_limit_per_user: row.usage_limit_per_user,
  welcome_only:         row.welcome_only,
  is_active:            row.is_active,
  created_at:           row.created_at,
  updated_at:           row.updated_at,
  total_usage_records:  row.total_usage_records !== undefined ? Number(row.total_usage_records) : undefined,
  reserved_count:       row.reserved_count !== undefined ? Number(row.reserved_count) : undefined,
  used_usage_count:     row.used_usage_count !== undefined ? Number(row.used_usage_count) : undefined,
  rolled_back_count:    row.rolled_back_count !== undefined ? Number(row.rolled_back_count) : undefined,
  cancelled_count:      row.cancelled_count !== undefined ? Number(row.cancelled_count) : undefined,
});

const ensureAirlineExists = async (airlineId) => {
  if (airlineId === null) return;
  const parsedAirlineId = parseOptionalInteger(airlineId, "airline_id");
  const result          = await pool.query(Q.CHECK_AIRLINE_ID_EXISTS, [parsedAirlineId]);
  if (result.rows.length === 0) throw new Error("airline_id không tồn tại");
};

const validateCouponInput = async (data, isUpdate = false) => {
  const prepared = {};

  if (!isUpdate || data.code !== undefined)   { prepared.code = normalizeCode(data.code); }
  if (!isUpdate || data.type !== undefined)   {
    if (!VALID_TYPES.includes(data.type)) throw new Error(`type phải là: ${VALID_TYPES.join(", ")}`);
    prepared.type = data.type;
  }
  if (!isUpdate || data.value !== undefined)  {
    const value = parseOptionalNumber(data.value, "value");
    if (value === null || value < 0) throw new Error("value phải lớn hơn hoặc bằng 0");
    prepared.value = value;
  }
  if (!isUpdate || data.airline_id !== undefined) {
    prepared.airline_id = parseOptionalInteger(data.airline_id, "airline_id");
    await ensureAirlineExists(prepared.airline_id);
  }
  if (!isUpdate || data.min_order !== undefined) {
    prepared.min_order = parseOptionalNumber(data.min_order, "min_order");
    if (prepared.min_order !== null && prepared.min_order < 0) throw new Error("min_order phải lớn hơn hoặc bằng 0");
  }
  if (!isUpdate || data.max_discount !== undefined) {
    prepared.max_discount = parseOptionalNumber(data.max_discount, "max_discount");
    if (prepared.max_discount !== null && prepared.max_discount < 0) throw new Error("max_discount phải lớn hơn hoặc bằng 0");
  }
  if (!isUpdate || data.start_at !== undefined)  { prepared.start_at  = parseOptionalDate(data.start_at, "start_at"); }
  if (!isUpdate || data.expiry_at !== undefined) { prepared.expiry_at = parseOptionalDate(data.expiry_at, "expiry_at"); }
  if (!isUpdate || data.usage_limit !== undefined) {
    prepared.usage_limit = parseOptionalInteger(data.usage_limit, "usage_limit");
    if (prepared.usage_limit !== null && prepared.usage_limit < 0) throw new Error("usage_limit phải lớn hơn hoặc bằng 0");
  }
  if (!isUpdate || data.usage_limit_per_user !== undefined) {
    prepared.usage_limit_per_user = parseOptionalInteger(data.usage_limit_per_user, "usage_limit_per_user");
    if (prepared.usage_limit_per_user !== null && prepared.usage_limit_per_user < 0) throw new Error("usage_limit_per_user phải lớn hơn hoặc bằng 0");
  }
  if (!isUpdate || data.welcome_only !== undefined)  { prepared.welcome_only = parseOptionalBoolean(data.welcome_only, "welcome_only"); }
  if (!isUpdate || data.is_active !== undefined)     { prepared.is_active    = parseOptionalBoolean(data.is_active, "is_active"); }
  if (!isUpdate || data.name !== undefined)        { prepared.name        = data.name === undefined ? undefined : (data.name || null); }
  if (!isUpdate || data.description !== undefined) { prepared.description = data.description === undefined ? undefined : (data.description || null); }

  const finalType  = prepared.type !== undefined ? prepared.type : data.type;
  const finalValue = prepared.value !== undefined ? prepared.value : parseOptionalNumber(data.value, "value");
  if (finalType === "percent" && finalValue !== null && finalValue > 100) {
    throw new Error("value không được lớn hơn 100 khi type là percent");
  }

  const startAt  = prepared.start_at  !== undefined ? prepared.start_at  : parseOptionalDate(data.start_at,  "start_at");
  const expiryAt = prepared.expiry_at !== undefined ? prepared.expiry_at : parseOptionalDate(data.expiry_at, "expiry_at");
  if (startAt && expiryAt && new Date(expiryAt) < new Date(startAt)) {
    throw new Error("expiry_at phải sau hoặc bằng start_at");
  }

  return prepared;
};

const getCouponById = async (couponId) => {
  const result = await pool.query(Q.SELECT_COUPON_BY_ID, [couponId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy coupon");
  return sanitizeCoupon(result.rows[0]);
};

const getCoupons = async (params) => {
  const {
    page = 1, limit = 10, search, type, airline_id, is_active,
    welcome_only, active_now, sort_by = "created_at", sort_order = "desc",
  } = params;

  const pageNum  = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
  const offset   = (pageNum - 1) * limitNum;

  const conditions = [];
  const values     = [];
  let   idx        = 1;

  if (search) {
    conditions.push(`(v.code ILIKE $${idx} OR COALESCE(v.name, '') ILIKE $${idx} OR COALESCE(v.description, '') ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }
  if (type) {
    if (!VALID_TYPES.includes(type)) throw new Error(`type phải là: ${VALID_TYPES.join(", ")}`);
    conditions.push(`v.type = $${idx}`); values.push(type); idx++;
  }
  if (airline_id !== undefined && airline_id !== "") {
    conditions.push(`v.airline_id = $${idx}`); values.push(parseOptionalInteger(airline_id, "airline_id")); idx++;
  }
  if (is_active !== undefined && is_active !== "") {
    conditions.push(`v.is_active = $${idx}`); values.push(parseOptionalBoolean(is_active, "is_active")); idx++;
  }
  if (welcome_only !== undefined && welcome_only !== "") {
    conditions.push(`v.welcome_only = $${idx}`); values.push(parseOptionalBoolean(welcome_only, "welcome_only")); idx++;
  }
  if (active_now === true || active_now === "true") {
    conditions.push(`v.is_active = TRUE`);
    conditions.push(`(v.start_at IS NULL OR v.start_at <= NOW())`);
    conditions.push(`(v.expiry_at IS NULL OR v.expiry_at >= NOW())`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allowedSortFields = {
    code: "v.code", type: "v.type", value: "v.value",
    min_order: "v.min_order", expiry_at: "v.expiry_at",
    used_count: "v.used_count", created_at: "v.created_at", updated_at: "v.updated_at",
  };
  const orderBy        = allowedSortFields[sort_by] || "v.created_at";
  const orderDirection = String(sort_order).toLowerCase() === "asc" ? "ASC" : "DESC";

  const countResult = await pool.query(Q.COUNT_COUPONS(whereClause), values);
  const total       = parseInt(countResult.rows[0].total, 10);

  const dataResult = await pool.query(
    Q.SELECT_COUPONS(whereClause, orderBy, orderDirection, idx, idx + 1),
    [...values, limitNum, offset]
  );

  return {
    data: dataResult.rows.map(sanitizeCoupon),
    pagination: { total, page: pageNum, limit: limitNum, total_pages: Math.ceil(total / limitNum) },
  };
};

const createCoupon = async (data) => {
  const prepared = await validateCouponInput(data);

  const existing = await pool.query(Q.FIND_COUPON_CODE_EXISTS, [prepared.code]);
  if (existing.rows.length > 0) throw new Error(`Coupon với code "${prepared.code}" đã tồn tại`);

  const result = await pool.query(Q.INSERT_COUPON, [
    prepared.airline_id ?? null,
    prepared.code, prepared.type, prepared.value,
    prepared.min_order, prepared.max_discount,
    prepared.start_at, prepared.expiry_at,
    prepared.usage_limit, prepared.usage_limit_per_user,
    prepared.welcome_only, prepared.is_active,
    prepared.name, prepared.description,
  ]);

  return getCouponById(result.rows[0].id);
};

const updateCoupon = async (couponId, data) => {
  const existing = await pool.query(Q.SELECT_COUPON_USAGE_INFO, [couponId]);
  if (existing.rows.length === 0) throw new Error("Không tìm thấy coupon");

  const prepared = await validateCouponInput(data, true);

  if (prepared.code) {
    const duplicated = await pool.query(Q.FIND_COUPON_CODE_EXISTS_EXCLUDE, [prepared.code, couponId]);
    if (duplicated.rows.length > 0) throw new Error(`Coupon với code "${prepared.code}" đã tồn tại`);
  }

  if (prepared.usage_limit !== undefined && prepared.usage_limit !== null &&
      prepared.usage_limit < existing.rows[0].used_count) {
    throw new Error("usage_limit không được nhỏ hơn used_count hiện tại");
  }

  const fields = [];
  const values = [];
  let   idx    = 1;

  const pushField = (field, value) => { fields.push(`${field} = $${idx++}`); values.push(value); };

  if (prepared.airline_id          !== undefined) pushField("airline_id",          prepared.airline_id);
  if (prepared.code                !== undefined) pushField("code",                prepared.code);
  if (prepared.type                !== undefined) pushField("type",                prepared.type);
  if (prepared.value               !== undefined) pushField("value",               prepared.value);
  if (prepared.min_order           !== undefined) pushField("min_order",           prepared.min_order ?? 0);
  if (prepared.max_discount        !== undefined) pushField("max_discount",        prepared.max_discount);
  if (prepared.start_at            !== undefined) pushField("start_at",            prepared.start_at);
  if (prepared.expiry_at           !== undefined) pushField("expiry_at",           prepared.expiry_at);
  if (prepared.usage_limit         !== undefined) pushField("usage_limit",         prepared.usage_limit);
  if (prepared.usage_limit_per_user !== undefined) pushField("usage_limit_per_user", prepared.usage_limit_per_user);
  if (prepared.welcome_only        !== undefined) pushField("welcome_only",        prepared.welcome_only ?? false);
  if (prepared.is_active           !== undefined) pushField("is_active",           prepared.is_active ?? true);
  if (prepared.name                !== undefined) pushField("name",                prepared.name);
  if (prepared.description         !== undefined) pushField("description",         prepared.description);

  if (fields.length === 0) throw new Error("Không có thông tin nào để cập nhật");

  fields.push("updated_at = NOW()");
  values.push(couponId);

  await pool.query(Q.UPDATE_COUPON_FIELDS(fields, idx), values);
  return getCouponById(couponId);
};

const updateCouponStatus = async (couponId, isActive) => {
  const parsedStatus = parseOptionalBoolean(isActive, "is_active");

  const result = await pool.query(Q.UPDATE_COUPON_STATUS, [parsedStatus, couponId]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy coupon");

  return {
    message: parsedStatus ? "Đã kích hoạt coupon" : "Đã vô hiệu hóa coupon",
    coupon: await getCouponById(couponId),
  };
};

const deleteCoupon = async (couponId) => {
  const existing = await pool.query(Q.SELECT_COUPON_FOR_DELETE, [couponId]);
  if (existing.rows.length === 0) throw new Error("Không tìm thấy coupon");

  const coupon = existing.rows[0];
  if (Number(coupon.usage_count) > 0 || Number(coupon.used_count) > 0) {
    throw new Error("Coupon đã có lịch sử sử dụng, không thể xóa cứng. Hãy dùng cập nhật status để vô hiệu hóa");
  }

  await pool.query(Q.DELETE_COUPON, [couponId]);
  return { message: "Xóa coupon thành công", id: coupon.id, code: coupon.code };
};

module.exports = { getCoupons, getCouponById, createCoupon, updateCoupon, updateCouponStatus, deleteCoupon };
