"use strict";

/**
 * SQL queries liên quan đến bảng wishlists
 * Được dùng bởi: wishlist.service.js
 */

// Kiểm tra flight có tồn tại và còn active không
const FIND_ACTIVE_FLIGHT =
  `SELECT f.id, f.flight_number, f.departure_time, f.arrival_time,
          f.status, f.is_active,
          al.name AS airline_name, al.code AS airline_code,
          dep.code AS dep_code, dep.city AS dep_city,
          arr.code AS arr_code, arr.city AS arr_city,
          fs.base_price, fs.available_seats
   FROM flights f
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = $2
   WHERE f.id = $1 AND f.is_active = TRUE`;

// Kiểm tra đã có trong wishlist chưa (user)
const FIND_WISHLIST_BY_USER =
  `SELECT id FROM wishlists
   WHERE user_id = $1 AND flight_id = $2 AND seat_class = $3
   LIMIT 1`;

// Kiểm tra đã có trong wishlist chưa (guest)
const FIND_WISHLIST_BY_GUEST =
  `SELECT id FROM wishlists
   WHERE guest_session_id = $1 AND flight_id = $2 AND seat_class = $3
   LIMIT 1`;

// Thêm vào wishlist (user đã đăng nhập)
const INSERT_WISHLIST_USER =
  `INSERT INTO wishlists (user_id, flight_id, seat_class)
   VALUES ($1, $2, $3)
   RETURNING id, user_id, flight_id, seat_class, created_at`;

// Thêm vào wishlist (guest)
const INSERT_WISHLIST_GUEST =
  `INSERT INTO wishlists (guest_session_id, flight_id, seat_class)
   VALUES ($1, $2, $3)
   RETURNING id, guest_session_id, flight_id, seat_class, created_at`;

// Xóa khỏi wishlist (user)
const DELETE_WISHLIST_BY_USER =
  `DELETE FROM wishlists
   WHERE user_id = $1 AND flight_id = $2 AND seat_class = $3
   RETURNING id`;

// Xóa khỏi wishlist (guest)
const DELETE_WISHLIST_BY_GUEST =
  `DELETE FROM wishlists
   WHERE guest_session_id = $1 AND flight_id = $2 AND seat_class = $3
   RETURNING id`;

// Xem wishlist của user
const SELECT_WISHLIST_BY_USER =
  `SELECT
     w.id, w.seat_class, w.created_at,
     f.id AS flight_id, f.flight_number,
     f.departure_time, f.arrival_time, f.duration_minutes,
     f.status AS flight_status,
     al.code AS airline_code, al.name AS airline_name, al.logo_url,
     dep.code AS dep_code, dep.city AS dep_city,
     arr.code AS arr_code, arr.city AS arr_city,
     fs.base_price, fs.available_seats
   FROM wishlists w
   JOIN flights      f   ON f.id   = w.flight_id
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = w.seat_class
   WHERE w.user_id = $1
   ORDER BY w.created_at DESC`;

// Xem wishlist của guest
const SELECT_WISHLIST_BY_GUEST =
  `SELECT
     w.id, w.seat_class, w.created_at,
     f.id AS flight_id, f.flight_number,
     f.departure_time, f.arrival_time, f.duration_minutes,
     f.status AS flight_status,
     al.code AS airline_code, al.name AS airline_name, al.logo_url,
     dep.code AS dep_code, dep.city AS dep_city,
     arr.code AS arr_code, arr.city AS arr_city,
     fs.base_price, fs.available_seats
   FROM wishlists w
   JOIN flights      f   ON f.id   = w.flight_id
   JOIN airlines     al  ON al.id  = f.airline_id
   JOIN airports     dep ON dep.id = f.departure_airport_id
   JOIN airports     arr ON arr.id = f.arrival_airport_id
   LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = w.seat_class
   WHERE w.guest_session_id = $1
   ORDER BY w.created_at DESC`;

// Sync wishlist: chuyển toàn bộ wishlist guest sang user (dùng cho CU-03)
const SYNC_WISHLIST_GUEST_TO_USER =
  `INSERT INTO wishlists (user_id, flight_id, seat_class)
   SELECT $1, flight_id, seat_class
   FROM wishlists
   WHERE guest_session_id = $2
   ON CONFLICT (user_id, flight_id, seat_class) DO NOTHING`;

// Xóa wishlist guest sau khi sync (dùng cho CU-03)
const DELETE_WISHLIST_BY_GUEST_SESSION =
  `DELETE FROM wishlists WHERE guest_session_id = $1`;

module.exports = {
  FIND_ACTIVE_FLIGHT,
  FIND_WISHLIST_BY_USER,
  FIND_WISHLIST_BY_GUEST,
  INSERT_WISHLIST_USER,
  INSERT_WISHLIST_GUEST,
  DELETE_WISHLIST_BY_USER,
  DELETE_WISHLIST_BY_GUEST,
  SELECT_WISHLIST_BY_USER,
  SELECT_WISHLIST_BY_GUEST,
  SYNC_WISHLIST_GUEST_TO_USER,
  DELETE_WISHLIST_BY_GUEST_SESSION,
};
