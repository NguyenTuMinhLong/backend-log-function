"use strict";

/**
 * SQL queries liên quan đến bảng flight_schedules
 * Được dùng bởi: admin/flight.service.js, schedule.job.js
 */

const COUNT_SCHEDULES = (dk) =>
  `SELECT COUNT(*) FROM flight_schedules fs
   JOIN airlines  al  ON al.id  = fs.airline_id
   JOIN airports  dep ON dep.id = fs.departure_airport_id
   JOIN airports  arr ON arr.id = fs.arrival_airport_id
   ${dk}`;

const SELECT_SCHEDULES = (dk, gioiHan, viTri) =>
  `SELECT
     fs.id, fs.flight_number, fs.departure_time, fs.arrival_time,
     fs.duration_minutes, fs.days_of_week,
     fs.start_date, fs.end_date, fs.is_active,
     fs.seats, fs.created_at, fs.updated_at,
     al.id   AS airline_id,  al.code  AS airline_code,  al.name AS airline_name,
     dep.id  AS dep_id,      dep.code AS dep_code,      dep.city AS dep_city,
     arr.id  AS arr_id,      arr.code AS arr_code,      arr.city AS arr_city
   FROM flight_schedules fs
   JOIN airlines  al  ON al.id  = fs.airline_id
   JOIN airports  dep ON dep.id = fs.departure_airport_id
   JOIN airports  arr ON arr.id = fs.arrival_airport_id
   ${dk}
   ORDER BY fs.created_at DESC
   LIMIT $${gioiHan} OFFSET $${viTri}`;

const FIND_SCHEDULE_BY_ID =
  `SELECT
     fs.*,
     al.code  AS airline_code,  al.name AS airline_name,
     dep.code AS dep_code,      dep.city AS dep_city,
     arr.code AS arr_code,      arr.city AS arr_city
   FROM flight_schedules fs
   JOIN airlines  al  ON al.id  = fs.airline_id
   JOIN airports  dep ON dep.id = fs.departure_airport_id
    JOIN airports  arr ON arr.id = fs.arrival_airport_id
   WHERE fs.id = $1`;

const INSERT_SCHEDULE =
  `INSERT INTO flight_schedules (
     flight_number, airline_id,
     departure_airport_id, arrival_airport_id,
     departure_time, arrival_time, duration_minutes,
     days_of_week, start_date, end_date, seats
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
   RETURNING *`;

const UPDATE_SCHEDULE_STATUS =
  `UPDATE flight_schedules
   SET is_active = $1, updated_at = NOW()
   WHERE id = $2
   RETURNING id, flight_number, is_active`;

const DELETE_SCHEDULE =
  `DELETE FROM flight_schedules WHERE id = $1`;

// Lấy tất cả schedule đang active để cron job generate
const SELECT_ACTIVE_SCHEDULES =
  `SELECT
     fs.*,
     al.code  AS airline_code,
     dep.code AS dep_code,
     arr.code AS arr_code
   FROM flight_schedules fs
   JOIN airlines  al  ON al.id  = fs.airline_id
     JOIN airports  dep ON dep.id = fs.departure_airport_id
   JOIN airports  arr ON arr.id = fs.arrival_airport_id
   WHERE fs.is_active = TRUE
     AND (fs.end_date IS NULL OR fs.end_date >= CURRENT_DATE)`;

// Kiểm tra chuyến bay đã tồn tại chưa (tránh tạo trùng)
const CHECK_FLIGHT_EXISTS =
  `SELECT id FROM flights
   WHERE flight_number = $1
     AND DATE(departure_time) = $2
     AND airline_id = $3`;

module.exports = {
  COUNT_SCHEDULES,
  SELECT_SCHEDULES,
  FIND_SCHEDULE_BY_ID,
  INSERT_SCHEDULE,
  UPDATE_SCHEDULE_STATUS,
  DELETE_SCHEDULE,
  SELECT_ACTIVE_SCHEDULES,
  CHECK_FLIGHT_EXISTS,
};