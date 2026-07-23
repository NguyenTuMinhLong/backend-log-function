"use strict";

/**
 * SQL queries liên quan đến bảng airlines
 * Được dùng bởi: admin.airline.service.js, admin.flight.service.js, flight.service.js, booking.service.js
 */

const COUNT_AIRLINES = (dk) =>
  `SELECT COUNT(*) FROM airlines ${dk}`;

const SELECT_AIRLINES = (dk, gioiHan, viTri) =>
  `SELECT id, code, name, country, logo_url, logo_dark, logo_light, price_tier, is_active, created_at
   FROM airlines
   ${dk}
   ORDER BY name ASC
   LIMIT $${gioiHan} OFFSET $${viTri}`;

// Dùng bởi admin.flight.service.js (SELECT *)
const SELECT_AIRLINES_ALL = (dk, gioiHan, viTri) =>
  `SELECT * FROM airlines ${dk} ORDER BY name LIMIT $${gioiHan} OFFSET $${viTri}`;

const FIND_AIRLINE_BY_CODE =
  `SELECT id FROM airlines WHERE UPPER(code) = UPPER($1)`;

const FIND_AIRLINE_BY_ID =
  `SELECT id FROM airlines WHERE id = $1`;

const FIND_ACTIVE_AIRLINE_BY_ID =
  `SELECT id FROM airlines WHERE id = $1 AND is_active = TRUE`;

const INSERT_AIRLINE =
  `INSERT INTO airlines (code, name, country, logo_url, logo_dark, logo_light, price_tier)
   VALUES (UPPER($1), $2, $3, $4, $5, $6, $7)
   RETURNING *`;

// Dùng bởi admin.flight.service.js (không UPPER code)
const INSERT_AIRLINE_SIMPLE =
  `INSERT INTO airlines (code, name, logo_url, logo_dark, logo_light) VALUES ($1, $2, $3, $4, $5) RETURNING *`;

const UPDATE_AIRLINE_FIELDS = (truong, stt) =>
  `UPDATE airlines SET ${truong.join(", ")} WHERE id = $${stt} RETURNING *`;

const UPDATE_AIRLINE_STATUS =
  `UPDATE airlines SET is_active = $1 WHERE id = $2
   RETURNING id, code, name, is_active`;

const TOGGLE_AIRLINE_STATUS =
  `UPDATE airlines SET is_active = NOT is_active WHERE id = $1
   RETURNING id, code, name, is_active`;

// Public - chỉ lấy hãng đang hoạt động
const SELECT_ACTIVE_AIRLINES =
  `SELECT id, code, name, logo_url, logo_dark, logo_light
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