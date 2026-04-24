"use strict";

/**
 * SQL queries liên quan đến bảng vouchers và coupon_usages
 * Được dùng bởi: admin.coupon.service.js, coupon.service.js, payment.service.js
 */

// ── Select ─────────────────────────────────────────────────────────────────────

const COUNT_COUPONS = (whereClause) =>
  `SELECT COUNT(*) AS total FROM vouchers v ${whereClause}`;

const SELECT_COUPONS = (whereClause, orderBy, orderDirection, limitIdx, offsetIdx) =>
  `SELECT
     v.id, v.airline_id,
     a.code AS airline_code, a.name AS airline_name,
     v.code, v.name, v.description,
     v.type, v.value, v.min_order, v.max_discount,
     v.start_at, v.expiry_at,
     v.usage_limit, v.used_count, v.usage_limit_per_user,
     v.welcome_only, v.is_active,
     v.created_at, v.updated_at,
     COUNT(cu.id) AS total_usage_records,
     COUNT(*) FILTER (WHERE cu.status = 'reserved')      AS reserved_count,
     COUNT(*) FILTER (WHERE LOWER(cu.status) = 'used')   AS used_usage_count,
     COUNT(*) FILTER (WHERE cu.status = 'rolled_back')   AS rolled_back_count,
     COUNT(*) FILTER (WHERE cu.status = 'cancelled')     AS cancelled_count
   FROM vouchers v
   LEFT JOIN airlines a ON a.id = v.airline_id
   LEFT JOIN coupon_usages cu ON cu.coupon_id = v.id
   ${whereClause}
   GROUP BY v.id, a.code, a.name
   ORDER BY ${orderBy} ${orderDirection}, v.code ASC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

const SELECT_COUPON_BY_ID =
  `SELECT
     v.id, v.airline_id,
     a.code AS airline_code, a.name AS airline_name,
     v.code, v.name, v.description,
     v.type, v.value, v.min_order, v.max_discount,
     v.start_at, v.expiry_at,
     v.usage_limit, v.used_count, v.usage_limit_per_user,
     v.welcome_only, v.is_active,
     v.created_at, v.updated_at,
     COUNT(cu.id) AS total_usage_records,
     COUNT(*) FILTER (WHERE cu.status = 'reserved')      AS reserved_count,
     COUNT(*) FILTER (WHERE LOWER(cu.status) = 'used')   AS used_usage_count,
     COUNT(*) FILTER (WHERE cu.status = 'rolled_back')   AS rolled_back_count,
     COUNT(*) FILTER (WHERE cu.status = 'cancelled')     AS cancelled_count
   FROM vouchers v
   LEFT JOIN airlines a ON a.id = v.airline_id
   LEFT JOIN coupon_usages cu ON cu.coupon_id = v.id
   WHERE v.id = $1
   GROUP BY v.id, a.code, a.name`;

const FIND_COUPON_CODE_EXISTS =
  `SELECT id FROM vouchers WHERE code = $1`;

const FIND_COUPON_CODE_EXISTS_EXCLUDE =
  `SELECT id FROM vouchers WHERE code = $1 AND id <> $2`;

const SELECT_COUPON_FOR_DELETE =
  `SELECT v.id, v.code, v.used_count, COUNT(cu.id) AS usage_count
   FROM vouchers v
   LEFT JOIN coupon_usages cu ON cu.coupon_id = v.id
   WHERE v.id = $1
   GROUP BY v.id, v.code, v.used_count`;

const SELECT_COUPON_USAGE_INFO =
  `SELECT id, code, used_count FROM vouchers WHERE id = $1`;

// Public coupon query
const SELECT_PUBLIC_COUPONS = (whereClause, limitIdx) =>
  `SELECT
     v.id, v.airline_id,
     a.code AS airline_code, a.name AS airline_name,
     v.code, v.name, v.description,
     v.type, v.value, v.min_order, v.max_discount,
     v.start_at, v.expiry_at,
     v.usage_limit, v.used_count, v.usage_limit_per_user,
     v.welcome_only, v.is_active,
     v.created_at, v.updated_at,
     CASE
       WHEN v.is_active = TRUE
         AND (v.start_at IS NULL OR v.start_at <= NOW())
         AND (v.expiry_at IS NULL OR v.expiry_at >= NOW())
         AND (v.usage_limit IS NULL OR v.used_count < v.usage_limit)
       THEN TRUE
       ELSE FALSE
     END AS is_available_now
   FROM vouchers v
   LEFT JOIN airlines a ON a.id = v.airline_id
   ${whereClause}
   ORDER BY v.updated_at DESC, v.created_at DESC, v.code ASC
   LIMIT $${limitIdx}`;

// ── Insert / Update / Delete ───────────────────────────────────────────────────

const INSERT_COUPON =
  `INSERT INTO vouchers (
     airline_id, code, type, value,
     min_order, max_discount,
     start_at, expiry_at,
     usage_limit, usage_limit_per_user,
     welcome_only, is_active,
     name, description
   )
   VALUES ($1, $2, $3, $4, COALESCE($5, 0), $6, $7, $8, $9, $10,
           COALESCE($11, FALSE), COALESCE($12, TRUE), $13, $14)
   RETURNING id`;

const UPDATE_COUPON_FIELDS = (fields, idx) =>
  `UPDATE vouchers SET ${fields.join(", ")} WHERE id = $${idx}`;

const UPDATE_COUPON_STATUS =
  `UPDATE vouchers SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING id`;

const DELETE_COUPON =
  `DELETE FROM vouchers WHERE id = $1`;

const INCREMENT_COUPON_USED_COUNT =
  `UPDATE vouchers SET used_count = used_count + 1, updated_at = NOW() WHERE id = $1`;

// ── Coupon Usages ──────────────────────────────────────────────────────────────

const CHECK_AIRLINE_ID_EXISTS =
  `SELECT id FROM airlines WHERE id = $1`;

const SELECT_COUPON_USAGE_COUNTS =
  `SELECT
     COUNT(*) FILTER (WHERE status = 'reserved')    AS reserved_count,
     COUNT(*) FILTER (WHERE LOWER(status) = 'used') AS used_count
   FROM coupon_usages
   WHERE coupon_id = $1`;

const SELECT_COUPON_USAGE_PER_USER =
  `SELECT COUNT(*) AS total
   FROM coupon_usages
   WHERE coupon_id = $1
     AND user_id = $2
     AND LOWER(status) IN ('reserved', 'used')`;

const SELECT_WELCOME_ONLY_CHECK =
  `SELECT
     EXISTS (
       SELECT 1 FROM bookings
       WHERE user_id = $1 AND status = 'confirmed'
     ) AS has_confirmed_booking,
     EXISTS (
       SELECT 1 FROM payments
       WHERE user_id = $1 AND status = 'SUCCESS'
     ) AS has_success_payment`;

const INSERT_COUPON_USAGE =
  `INSERT INTO coupon_usages (coupon_id, user_id, booking_id, status, discount_amount, reserved_at)
   VALUES ($1, $2, $3, 'reserved', $4, NOW())`;

const MARK_COUPON_USAGE_USED =
  `UPDATE coupon_usages
   SET status = 'USED', used_at = NOW()
   WHERE booking_id = $1 AND coupon_id = $2 AND status = 'reserved'
   RETURNING id`;

const ROLLBACK_RESERVED_COUPON_USAGE =
  `UPDATE coupon_usages
   SET status = 'rolled_back', rolled_back_at = NOW()
   WHERE booking_id = $1 AND status = 'reserved'`;

const SELECT_VOUCHER_BY_CODE =
  `SELECT * FROM vouchers WHERE code = $1 LIMIT 1`;

module.exports = {
  COUNT_COUPONS,
  SELECT_COUPONS,
  SELECT_COUPON_BY_ID,
  FIND_COUPON_CODE_EXISTS,
  FIND_COUPON_CODE_EXISTS_EXCLUDE,
  SELECT_COUPON_FOR_DELETE,
  SELECT_COUPON_USAGE_INFO,
  SELECT_PUBLIC_COUPONS,
  INSERT_COUPON,
  UPDATE_COUPON_FIELDS,
  UPDATE_COUPON_STATUS,
  DELETE_COUPON,
  INCREMENT_COUPON_USED_COUNT,
  CHECK_AIRLINE_ID_EXISTS,
  SELECT_COUPON_USAGE_COUNTS,
  SELECT_COUPON_USAGE_PER_USER,
  SELECT_WELCOME_ONLY_CHECK,
  INSERT_COUPON_USAGE,
  MARK_COUPON_USAGE_USED,
  ROLLBACK_RESERVED_COUPON_USAGE,
  SELECT_VOUCHER_BY_CODE,
};
