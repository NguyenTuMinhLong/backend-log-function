'use strict';

/*
=========================================================
QUERIES: REFUND SYSTEM
=========================================================
*/

// =========================================================
// INSERT
// =========================================================

const INSERT_REFUND = `
  INSERT INTO refunds (
    refund_code,
    booking_id,
    refund_type,
    requested_items,
    refund_amount,
    admin_fee,
    net_refund_amount,
    refund_policy_applied,
    status,
    reason,
    user_notes,
    requested_by
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
  RETURNING *
`;

// =========================================================
// SELECT
// =========================================================

const SELECT_REFUND_BY_CODE = `
  SELECT
    r.*,
    b.booking_code,
    b.status AS booking_status,
    b.total_price AS booking_total_price,
    p.amount AS payment_amount,
    p.final_amount AS payment_final_amount,
    p.discount_amount AS payment_discount,
    u.email AS user_email,
    u.full_name AS user_name,
    admin.full_name AS admin_name
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  LEFT JOIN payments p ON p.id::text = r.payment_id::text
  LEFT JOIN users u ON u.id::text = r.requested_by::text
  LEFT JOIN users admin ON admin.id::text = r.processed_by::text
  WHERE r.refund_code = $1
`;

const SELECT_REFUND_BY_ID = `
  SELECT
    r.*,
    b.booking_code,
    b.status AS booking_status,
    b.total_price AS booking_total_price,
    p.amount AS payment_amount,
    p.final_amount AS payment_final_amount,
    p.discount_amount AS payment_discount,
    u.email AS user_email,
    u.full_name AS user_name,
    admin.full_name AS admin_name
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  LEFT JOIN payments p ON p.id::text = r.payment_id::text
  LEFT JOIN users u ON u.id::text = r.requested_by::text
  LEFT JOIN users admin ON admin.id::text = r.processed_by::text
  WHERE r.id = $1
`;

const SELECT_REFUNDS_BY_BOOKING = `
  SELECT
    r.*,
    admin.full_name AS admin_name
  FROM refunds r
  LEFT JOIN users admin ON admin.id::text = r.processed_by::text
  WHERE r.booking_id = $1
  ORDER BY r.created_at DESC
`;

const SELECT_USER_REFUNDS = `
  SELECT
    r.*,
    b.booking_code,
    b.outbound_flight_id,
    f.flight_number AS outbound_flight_number,
    dep.code AS departure_code,
    arr.code AS arrival_code,
    b.total_price AS booking_total_price
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  JOIN flights f ON b.outbound_flight_id = f.id
  JOIN airports dep ON f.departure_airport_id = dep.id
  JOIN airports arr ON f.arrival_airport_id = arr.id
  WHERE r.requested_by = $1
  ORDER BY r.created_at DESC
  LIMIT $2 OFFSET $3
`;

const COUNT_USER_REFUNDS = `
  SELECT COUNT(*)
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  WHERE r.requested_by = $1
`;

// =========================================================
// ADMIN: LIST & FILTER
// =========================================================

const SELECT_PENDING_REFUNDS = `
  SELECT
    r.refund_code,
    r.refund_type,
    r.refund_amount,
    r.net_refund_amount,
    r.status,
    r.created_at,
    b.booking_code,
    b.total_price AS booking_total_price,
    b.contact_name,
    b.contact_email,
    u.full_name AS user_name,
    f.flight_number AS outbound_flight_number,
    dep.code AS departure_code,
    arr.code AS arrival_code,
    f.departure_time AS outbound_departure
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  JOIN flights f ON b.outbound_flight_id = f.id
  JOIN airports dep ON f.departure_airport_id = dep.id
  JOIN airports arr ON f.arrival_airport_id = arr.id
  LEFT JOIN users u ON u.id::text = r.requested_by::text
  WHERE r.status = 'pending'
  ORDER BY r.created_at ASC
  LIMIT $1 OFFSET $2
`;

const COUNT_PENDING_REFUNDS = `
  SELECT COUNT(*)
  FROM refunds
  WHERE status = 'pending'
`;

const SELECT_REFUNDS_ADMIN = (whereClause, idx, idx2) => `
  SELECT
    r.refund_code,
    r.refund_type,
    r.refund_amount,
    r.net_refund_amount,
    r.status,
    r.reason,
    r.created_at,
    r.processed_at,
    r.completed_at,
    b.booking_code,
    b.total_price AS booking_total_price,
    b.contact_name,
    b.contact_email,
    u.full_name AS user_name,
    f.flight_number AS outbound_flight_number,
    dep.code AS departure_code,
    arr.code AS arrival_code,
    f.departure_time AS outbound_departure,
    admin.full_name AS processed_by_name
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  JOIN flights f ON b.outbound_flight_id = f.id
  JOIN airports dep ON f.departure_airport_id = dep.id
  JOIN airports arr ON f.arrival_airport_id = arr.id
  LEFT JOIN users u ON u.id::text = r.requested_by::text
  LEFT JOIN users admin ON admin.id::text = r.processed_by::text
  ${whereClause}
  ORDER BY r.created_at DESC
  LIMIT $${idx} OFFSET $${idx2}
`;

const COUNT_REFUNDS_ADMIN = (whereClause) => `
  SELECT COUNT(*)
  FROM refunds r
  JOIN bookings b ON r.booking_id = b.id
  ${whereClause}
`;

// =========================================================
// UPDATE
// =========================================================

const UPDATE_REFUND_STATUS = `
  UPDATE refunds
  SET
    status = $1,
    processed_by = $2,
    processed_at = NOW(),
    admin_notes = COALESCE($3, admin_notes),
    updated_at = NOW()
  WHERE refund_code = $4
  RETURNING *
`;

const UPDATE_REFUND_COMPLETED = `
  UPDATE refunds
  SET
    status = 'completed',
    completed_at = NOW(),
    processed_by = $1,
    updated_at = NOW()
  WHERE refund_code = $2
  RETURNING *
`;

// =========================================================
// CHECKS
// =========================================================

const CHECK_REFUND_EXISTS_BY_CODE = `
  SELECT id, status FROM refunds WHERE refund_code = $1
`;

const CHECK_PENDING_REFUND_FOR_BOOKING = `
  SELECT id FROM refunds
  WHERE booking_id = $1
    AND status IN ('pending', 'approved', 'processing')
  LIMIT 1
`;

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  // Insert
  INSERT_REFUND,

  // Select
  SELECT_REFUND_BY_CODE,
  SELECT_REFUND_BY_ID,
  SELECT_REFUNDS_BY_BOOKING,
  SELECT_USER_REFUNDS,
  COUNT_USER_REFUNDS,

  // Admin
  SELECT_PENDING_REFUNDS,
  COUNT_PENDING_REFUNDS,
  SELECT_REFUNDS_ADMIN,
  COUNT_REFUNDS_ADMIN,

  // Update
  UPDATE_REFUND_STATUS,
  UPDATE_REFUND_COMPLETED,

  // Checks
  CHECK_REFUND_EXISTS_BY_CODE,
  CHECK_PENDING_REFUND_FOR_BOOKING,
};
