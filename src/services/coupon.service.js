const pool = require("../config/db");
const Q    = require("../queries/coupon.queries");

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
  is_available_now:     row.is_available_now,
});

const getPublicCoupons = async (params = {}, availableOnly = false) => {
  const {
    search,
    airline_id,
    code,
    welcome_only,
    limit = 50,
  } = params;

  const limitNum   = Math.max(parseInt(limit, 10) || 50, 1);
  const conditions = ["v.is_active = TRUE"];
  const values     = [];
  let   idx        = 1;

  if (search) {
    conditions.push(`(v.code ILIKE $${idx} OR COALESCE(v.name, '') ILIKE $${idx} OR COALESCE(v.description, '') ILIKE $${idx})`);
    values.push(`%${search}%`);
    idx++;
  }

  if (code) {
    conditions.push(`v.code = $${idx}`);
    values.push(String(code).trim().toUpperCase());
    idx++;
  }

  if (airline_id !== undefined && airline_id !== "") {
    conditions.push(`v.airline_id = $${idx}`);
    values.push(parseInt(airline_id, 10));
    idx++;
  }

  if (welcome_only !== undefined && welcome_only !== "") {
    const isWelcomeOnly = welcome_only === true || welcome_only === "true";
    conditions.push(`v.welcome_only = $${idx}`);
    values.push(isWelcomeOnly);
    idx++;
  }

  if (availableOnly) {
    conditions.push(`(v.start_at IS NULL OR v.start_at <= NOW())`);
    conditions.push(`(v.expiry_at IS NULL OR v.expiry_at >= NOW())`);
    conditions.push(`(v.usage_limit IS NULL OR v.used_count < v.usage_limit)`);
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const result = await pool.query(Q.SELECT_PUBLIC_COUPONS(whereClause, idx), [...values, limitNum]);
  return result.rows.map(sanitizeCoupon);
};

module.exports = { getPublicCoupons };
