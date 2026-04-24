"use strict";

/**
 * SQL queries liên quan đến bảng airports
 * Được dùng bởi: admin.airport.service.js, admin.flight.service.js, flight.service.js
 */

const COUNT_AIRPORTS = (whereClause) =>
  `SELECT COUNT(*) FROM airports ${whereClause}`;

const SELECT_AIRPORTS = (whereClause, limitIdx, offsetIdx) =>
  `SELECT id, code, name, city, country, timezone, is_active, created_at
   FROM airports
   ${whereClause}
   ORDER BY country ASC, city ASC
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

// Dùng bởi admin.flight.service.js (SELECT *)
const SELECT_AIRPORTS_ALL = (whereClause, limitIdx, offsetIdx) =>
  `SELECT * FROM airports ${whereClause} ORDER BY country, city LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

const FIND_AIRPORT_BY_CODE =
  `SELECT id FROM airports WHERE UPPER(code) = UPPER($1)`;

const FIND_AIRPORT_BY_ID =
  `SELECT id FROM airports WHERE id = $1`;

const FIND_ACTIVE_AIRPORT_BY_ID =
  `SELECT id FROM airports WHERE id = $1 AND is_active = TRUE`;

const INSERT_AIRPORT =
  `INSERT INTO airports (code, name, city, country, timezone)
   VALUES (UPPER($1), $2, $3, $4, $5)
   RETURNING *`;

const UPDATE_AIRPORT_FIELDS = (fields, idx) =>
  `UPDATE airports SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`;

const UPDATE_AIRPORT_STATUS =
  `UPDATE airports SET is_active = $1 WHERE id = $2
   RETURNING id, code, name, city, is_active`;

const TOGGLE_AIRPORT_STATUS =
  `UPDATE airports SET is_active = NOT is_active WHERE id = $1
   RETURNING id, code, name, is_active`;

// Public - chỉ lấy sân bay đang hoạt động
const SELECT_ACTIVE_AIRPORTS =
  `SELECT id, code, name, city, country
   FROM airports WHERE is_active = TRUE ORDER BY city ASC`;

module.exports = {
  COUNT_AIRPORTS,
  SELECT_AIRPORTS,
  SELECT_AIRPORTS_ALL,
  FIND_AIRPORT_BY_CODE,
  FIND_AIRPORT_BY_ID,
  FIND_ACTIVE_AIRPORT_BY_ID,
  INSERT_AIRPORT,
  UPDATE_AIRPORT_FIELDS,
  UPDATE_AIRPORT_STATUS,
  TOGGLE_AIRPORT_STATUS,
  SELECT_ACTIVE_AIRPORTS,
};
