"use strict";

// Kiểm tra flight có tồn tại và còn active không
const FIND_ACTIVE_FLIGHT =
  `SELECT f.id, fs.base_price, fs.available_seats
   FROM flights f
   LEFT JOIN flight_seats fs ON fs.flight_id = f.id AND fs.class = $2
   WHERE f.id = $1 AND f.is_active = TRUE`;

// Kiểm tra đã có trong wishlist chưa (user)
const FIND_WISHLIST_BY_USER =
  `SELECT id FROM wishlists
   WHERE user_id = $1 AND flight_id = $2 AND seat_class = $3
   LIMIT 1`;

// Thêm vào wishlist (user đã đăng nhập)
const INSERT_WISHLIST_USER =
  `INSERT INTO wishlists (user_id, flight_id, seat_class)
   VALUES ($1, $2, $3)
   RETURNING id, user_id, flight_id, seat_class, created_at`;

// Xóa khỏi wishlist (user)
const DELETE_WISHLIST_BY_USER =
  `DELETE FROM wishlists
   WHERE user_id = $1 AND flight_id = $2 AND seat_class = $3
   RETURNING id`;

// Xem wishlist của user (kèm thông tin chuyến bay đầy đủ)
const SELECT_WISHLIST_BY_USER =
  `SELECT
     w.id, w.seat_class, w.created_at,
     f.id AS flight_id, f.flight_number,
     f.departure_time, f.arrival_time, f.duration_minutes,
     f.status AS flight_status,
     al.code AS airline_code, al.name AS airline_name, al.logo_url, al.logo_dark, al.logo_light,
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

// CU-03: Sync từ localStorage → server (ON CONFLICT bỏ qua trùng lặp)
const SYNC_WISHLIST_GUEST_TO_USER =
  `INSERT INTO wishlists (user_id, flight_id, seat_class)
   VALUES ($1, $2, $3)
   ON CONFLICT (user_id, flight_id, seat_class) DO NOTHING`;

module.exports = {
  FIND_ACTIVE_FLIGHT,
  FIND_WISHLIST_BY_USER,
  INSERT_WISHLIST_USER,
  DELETE_WISHLIST_BY_USER,
  SELECT_WISHLIST_BY_USER,
  SYNC_WISHLIST_GUEST_TO_USER,
};