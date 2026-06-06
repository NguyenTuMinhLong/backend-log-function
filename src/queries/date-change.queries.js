'use strict';

/*
=========================================================
QUERIES: DATE CHANGE REQUESTS
=========================================================
*/

// =========================================================
// INSERT
// =========================================================

const INSERT_DATE_CHANGE = `
  INSERT INTO date_change_requests (
    request_code,
    booking_id,
    old_flight_id,
    new_flight_id,
    old_seat_class,
    new_seat_class,
    passenger_ids,
    old_price,
    new_price,
    price_difference,
    status,
    reason,
    requested_by,
    flight_leg
  )
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
  RETURNING *
`;

// =========================================================
// SELECT
// =========================================================

const SELECT_DATE_CHANGE_BY_CODE = `
  SELECT
    dcr.*,
    b.booking_code,
    b.status AS booking_status,
    u.full_name AS user_name,
    u.email AS user_email,
    admin.full_name AS admin_name,
    p.status AS payment_status,

    -- Old flight info
    old_f.flight_number AS old_flight_number,
    old_dep.code AS old_departure_code,
    old_dep.city AS old_departure_city,
    old_arr.code AS old_arrival_code,
    old_arr.city AS old_arrival_city,
    old_f.departure_time AS old_departure_time,
    old_f.arrival_time AS old_arrival_time,

    -- New flight info
    new_f.flight_number AS new_flight_number,
    new_dep.code AS new_departure_code,
    new_dep.city AS new_departure_city,
    new_arr.code AS new_arrival_code,
    new_arr.city AS new_arrival_city,
    new_f.departure_time AS new_departure_time,
    new_f.arrival_time AS new_arrival_time
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  JOIN flights old_f ON dcr.old_flight_id = old_f.id
  JOIN airports old_dep ON old_f.departure_airport_id = old_dep.id
  JOIN airports old_arr ON old_f.arrival_airport_id = old_arr.id
  JOIN flights new_f ON dcr.new_flight_id = new_f.id
  JOIN airports new_dep ON new_f.departure_airport_id = new_dep.id
  JOIN airports new_arr ON new_f.arrival_airport_id = new_arr.id
  LEFT JOIN users u ON dcr.requested_by = u.id
  LEFT JOIN users admin ON dcr.processed_by = admin.id
  LEFT JOIN payments p ON dcr.payment_id = p.id
  WHERE dcr.request_code = $1
`;

const SELECT_DATE_CHANGE_BY_ID = `
  SELECT
    dcr.*,
    b.booking_code,
    b.status AS booking_status
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  WHERE dcr.id = $1
`;

const SELECT_DATE_CHANGES_BY_BOOKING = `
  SELECT
    dcr.*,
    admin.full_name AS admin_name
  FROM date_change_requests dcr
  LEFT JOIN users admin ON dcr.processed_by = admin.id
  WHERE dcr.booking_id = $1
  ORDER BY dcr.created_at DESC
`;

const SELECT_USER_DATE_CHANGES = `
  SELECT
    dcr.*,
    b.booking_code,
    old_f.flight_number AS old_flight_number,
    new_f.flight_number AS new_flight_number
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  JOIN flights old_f ON dcr.old_flight_id = old_f.id
  JOIN flights new_f ON dcr.new_flight_id = new_f.id
  WHERE dcr.requested_by = $1
  ORDER BY dcr.created_at DESC
  LIMIT $2 OFFSET $3
`;

// =========================================================
// ADMIN: LIST & FILTER
// =========================================================

const SELECT_PENDING_DATE_CHANGES = `
  SELECT
    dcr.request_code,
    dcr.status,
    dcr.flight_leg,
    dcr.price_difference,
    dcr.created_at,
    dcr.paid_at,
    b.booking_code,
    b.contact_name,
    b.contact_email,
    u.full_name AS user_name,
    old_f.flight_number AS old_flight_number,
    new_f.flight_number AS new_flight_number,
    p.status AS payment_status
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  JOIN flights old_f ON dcr.old_flight_id = old_f.id
  JOIN flights new_f ON dcr.new_flight_id = new_f.id
  LEFT JOIN users u ON dcr.requested_by = u.id
  LEFT JOIN payments p ON dcr.payment_id = p.id
  WHERE dcr.status IN ('pending_payment', 'pending')
  ORDER BY
    CASE WHEN dcr.status = 'pending' THEN 0 ELSE 1 END,
    dcr.created_at ASC
  LIMIT $1 OFFSET $2
`;

const COUNT_PENDING_DATE_CHANGES = `
  SELECT COUNT(*)
  FROM date_change_requests
  WHERE status IN ('pending_payment', 'pending')
`;

const SELECT_DATE_CHANGES_ADMIN = (whereClause, idx, idx2) => `
  SELECT
    dcr.request_code,
    dcr.status,
    dcr.flight_leg,
    dcr.old_seat_class,
    dcr.new_seat_class,
    dcr.old_price,
    dcr.new_price,
    dcr.price_difference,
    dcr.reason,
    dcr.admin_notes,
    dcr.created_at,
    dcr.processed_at,
    dcr.paid_at,
    b.booking_code,
    b.contact_name,
    b.contact_email,
    u.full_name AS user_name,
    old_f.flight_number AS old_flight_number,
    old_f.departure_time AS old_departure_time,
    new_f.flight_number AS new_flight_number,
    new_f.departure_time AS new_departure_time,
    admin.full_name AS processed_by_name,
    p.status AS payment_status
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  JOIN flights old_f ON dcr.old_flight_id = old_f.id
  JOIN flights new_f ON dcr.new_flight_id = new_f.id
  LEFT JOIN users u ON dcr.requested_by = u.id
  LEFT JOIN users admin ON dcr.processed_by = admin.id
  LEFT JOIN payments p ON dcr.payment_id = p.id
  ${whereClause}
  ORDER BY dcr.created_at DESC
  LIMIT $${idx} OFFSET $${idx2}
`;

const COUNT_DATE_CHANGES_ADMIN = (whereClause) => `
  SELECT COUNT(*)
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  ${whereClause}
`;

// =========================================================
// UPDATE
// =========================================================

const UPDATE_DATE_CHANGE_STATUS = `
  UPDATE date_change_requests
  SET
    status = $1,
    processed_by = $2,
    processed_at = NOW(),
    admin_notes = COALESCE($3, admin_notes),
    updated_at = NOW()
  WHERE request_code = $4
  RETURNING *
`;

// Simple status update (for OTP verification - no processed_by needed)
const UPDATE_DATE_CHANGE_STATUS_SIMPLE = `
  UPDATE date_change_requests
  SET
    status = $1,
    updated_at = NOW()
  WHERE request_code = $2
  RETURNING *
`;

const UPDATE_DATE_CHANGE_COMPLETED = `
  UPDATE date_change_requests
  SET
    status = 'completed',
    processed_by = $1,
    processed_at = NOW(),
    updated_at = NOW()
  WHERE request_code = $2
  RETURNING *
`;

// =========================================================
// CHECKS
// =========================================================

const CHECK_DATE_CHANGE_EXISTS_BY_CODE = `
  SELECT id, status FROM date_change_requests WHERE request_code = $1
`;

const CHECK_PENDING_DATE_CHANGE_FOR_BOOKING = `
  SELECT id FROM date_change_requests
  WHERE booking_id = $1
    AND flight_leg = $2
    AND status IN ('pending', 'pending_otp', 'pending_payment')
  LIMIT 1
`;

const COUNT_APPROVED_DATE_CHANGES_FOR_LEG = `
  SELECT COUNT(*)
  FROM date_change_requests
  WHERE booking_id = $1
    AND flight_leg = $2
    AND status = 'approved'
`;

// =========================================================
// BOOKING UPDATE (for approved date change)
// =========================================================

const UPDATE_BOOKING_FLIGHT = `
  UPDATE bookings
  SET
    outbound_flight_id = $1,
    outbound_seat_class = $2,
    updated_at = NOW()
  WHERE id = $3
  RETURNING *
`;

const UPDATE_BOOKING_FLIGHT_ROUND_TRIP = `
  UPDATE bookings
  SET
    outbound_flight_id = $1,
    outbound_seat_class = $2,
    updated_at = NOW()
  WHERE id = $3
  RETURNING *
`;

// =========================================================
// PAYMENT QUERIES
// =========================================================

const SELECT_DATE_CHANGE_BY_PAYMENT_ID = `
  SELECT
    dcr.*,
    b.booking_code,
    b.contact_email,
    b.contact_name
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  WHERE dcr.payment_id = $1
`;

const SELECT_DATE_CHANGE_BY_PAYMENT_CODE = `
  SELECT
    dcr.*,
    b.booking_code,
    b.contact_email,
    b.contact_name
  FROM date_change_requests dcr
  JOIN bookings b ON dcr.booking_id = b.id
  WHERE dcr.payment_code = $1
`;

const UPDATE_DATE_CHANGE_PAYMENT_ID = `
  UPDATE date_change_requests
  SET
    payment_id = $1,
    payment_code = $2,
    updated_at = NOW()
  WHERE request_code = $3
  RETURNING *
`;

const UPDATE_DATE_CHANGE_PAID = `
  UPDATE date_change_requests
  SET
    status = 'pending',
    paid_at = NOW(),
    updated_at = NOW()
  WHERE payment_code = $1
  RETURNING *
`;

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  // Insert
  INSERT_DATE_CHANGE,

  // Select
  SELECT_DATE_CHANGE_BY_CODE,
  SELECT_DATE_CHANGE_BY_ID,
  SELECT_DATE_CHANGES_BY_BOOKING,
  SELECT_USER_DATE_CHANGES,

  // Payment
  SELECT_DATE_CHANGE_BY_PAYMENT_ID,
  SELECT_DATE_CHANGE_BY_PAYMENT_CODE,
  UPDATE_DATE_CHANGE_PAYMENT_ID,
  UPDATE_DATE_CHANGE_PAID,

  // Admin
  SELECT_PENDING_DATE_CHANGES,
  COUNT_PENDING_DATE_CHANGES,
  SELECT_DATE_CHANGES_ADMIN,
  COUNT_DATE_CHANGES_ADMIN,

  // Update
  UPDATE_DATE_CHANGE_STATUS,
  UPDATE_DATE_CHANGE_STATUS_SIMPLE,
  UPDATE_DATE_CHANGE_COMPLETED,
  UPDATE_BOOKING_FLIGHT,

  // Checks
  CHECK_DATE_CHANGE_EXISTS_BY_CODE,
  CHECK_PENDING_DATE_CHANGE_FOR_BOOKING,
  COUNT_APPROVED_DATE_CHANGES_FOR_LEG,
};
