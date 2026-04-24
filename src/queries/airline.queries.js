"use strict";

/**
 * SQL queries liên quan đến bảng airlines
 * Được dùng bởi: admin.airline.service.js, admin.flight.service.js, flight.service.js, booking.service.js
 */

const COUNT_AIRLINES = (whereClause) =>
  `SELECT COUNT(*) FROM airlines ${whereClause}`;

const SELECT_AIRLINES = (whereClause, limitIdx, offsetIdx) =>
  `SELECT id, code, name, logo_url, is_active, created_at
   FROM airlines
   ${whereClause}
   ORDER BY name ASC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

// Dùng bởi admin.flight.service.js (SELECT *)
const SELECT_AIRLINES_ALL = (whereClause, limitIdx, offsetIdx) =>
  `SELECT * FROM airlines ${whereClause} ORDER BY name LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

const FIND_AIRLINE_BY_CODE =
  `SELECT id FROM airlines WHERE UPPER(code) = UPPER($1)`;

const FIND_AIRLINE_BY_ID =
  `SELECT id FROM airlines WHERE id = $1`;

const FIND_ACTIVE_AIRLINE_BY_ID =
  `SELECT id FROM airlines WHERE id = $1 AND is_active = TRUE`;

const INSERT_AIRLINE =
  `INSERT INTO airlines (code, name, logo_url)
   VALUES (UPPER($1), $2, $3)
   RETURNING *`;

// Dùng bởi admin.flight.service.js (không UPPER code)
const INSERT_AIRLINE_SIMPLE =
  `INSERT INTO airlines (code, name, logo_url) VALUES ($1, $2, $3) RETURNING *`;

const UPDATE_AIRLINE_FIELDS = (fields, idx) =>
  `UPDATE airlines SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;

const UPDATE_AIRLINE_STATUS =
  `UPDATE airlines SET is_active = $1 WHERE id = $2
   RETURNING id, code, name, is_active`;

const TOGGLE_AIRLINE_STATUS =
  `UPDATE airlines SET is_active = NOT is_active WHERE id = $1
   RETURNING id, code, name, is_active`;

// Public - chỉ lấy hãng đang hoạt động
const SELECT_ACTIVE_AIRLINES =
  `SELECT id, code, name, logo_url
   FROM airlines WHERE is_active = TRUE ORDER BY name ASC`;

module.exports = {
  COUNT_AIRLINES,
  SELECT_AIRLINES,
  SELECT_AIRLINES_ALL,
  FIND_AIRLINE_BY_CODE,
  FIND_AIRLINE_BY_ID,
  FIND_ACTIVE_AIRLINE_BY_ID,
  INSERT_AIRLINE,
  INSERT_AIRLINE_SIMPLE,
  UPDATE_AIRLINE_FIELDS,
  UPDATE_AIRLINE_STATUS,
  TOGGLE_AIRLINE_STATUS,
  SELECT_ACTIVE_AIRLINES,
};
