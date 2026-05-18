"use strict";

const pool = require("../config/db");
const Q    = require("../queries/wishlist.queries");

const formatItem = (row) => ({
  id:         row.id,
  seat_class: row.seat_class,
  added_at:   row.created_at,
  flight: {
    id:               row.flight_id,
    flight_number:    row.flight_number,
    departure_time:   row.departure_time,
    arrival_time:     row.arrival_time,
    duration_minutes: row.duration_minutes,
    status:           row.flight_status,
    airline: {
      code:     row.airline_code,
      name:     row.airline_name,
      logo_url: row.logo_url,
    },
    departure:       { code: row.dep_code, city: row.dep_city },
    arrival:         { code: row.arr_code, city: row.arr_city },
    base_price:      row.base_price      ? parseFloat(row.base_price)    : null,
    available_seats: row.available_seats ? parseInt(row.available_seats) : null,
  },
});

/**
 * CU-02: Thêm chuyến bay vào wishlist (chỉ user đã login)
 */
const addToWishlist = async (userId, flightId, seatClass = "economy") => {
  const flightIdInt     = parseInt(flightId, 10);
  const normalizedClass = String(seatClass).toLowerCase();

  if (!flightIdInt || flightIdInt <= 0) throw new Error("flight_id không hợp lệ");
  if (!["economy", "business", "first"].includes(normalizedClass)) {
    throw new Error("seat_class phải là: economy, business, first");
  }

  // Kiểm tra flight tồn tại
  const flightResult = await pool.query(Q.FIND_ACTIVE_FLIGHT, [flightIdInt, normalizedClass]);
  if (flightResult.rows.length === 0) {
    throw new Error("Chuyến bay không tồn tại hoặc đã ngừng hoạt động");
  }

  // Kiểm tra đã có chưa
  const exists = await pool.query(Q.FIND_WISHLIST_BY_USER, [userId, flightIdInt, normalizedClass]);
  if (exists.rows.length > 0) throw new Error("Chuyến bay đã có trong danh sách yêu thích");

  const result = await pool.query(Q.INSERT_WISHLIST_USER, [userId, flightIdInt, normalizedClass]);
  return { message: "Đã thêm vào danh sách yêu thích", item: result.rows[0] };
};

/**
 * Xóa chuyến bay khỏi wishlist (chỉ user đã login)
 */
const removeFromWishlist = async (userId, flightId, seatClass = "economy") => {
  const flightIdInt     = parseInt(flightId, 10);
  const normalizedClass = String(seatClass).toLowerCase();

  const result = await pool.query(Q.DELETE_WISHLIST_BY_USER, [userId, flightIdInt, normalizedClass]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay trong danh sách yêu thích");

  return { message: "Đã xóa khỏi danh sách yêu thích" };
};

/**
 * CU-04: Xem wishlist (chỉ user đã login)
 * - Kiểm tra chuyến bay còn vé / hết vé
 * - Hiển thị giá hiện tại so với giá lúc lưu
 */
const getWishlist = async (userId) => {
  const result = await pool.query(Q.SELECT_WISHLIST_BY_USER, [userId]);

  return {
    total: result.rows.length,
    items: result.rows.map(formatItem),
  };
};

/**
 * CU-03: Sync wishlist từ localStorage (guest) → server sau khi đăng nhập
 * Frontend gửi lên mảng items từ localStorage
 * Backend merge vào database, loại bỏ trùng lặp
 */
const syncWishlist = async (userId, localItems = []) => {
  if (!Array.isArray(localItems) || localItems.length === 0) {
    return { synced: 0, skipped: 0, message: "Không có dữ liệu để sync" };
  }

  let synced  = 0;
  let skipped = 0;

  for (const item of localItems) {
    try {
      const flightIdInt     = parseInt(item.flight_id, 10);
      const normalizedClass = String(item.seat_class || "economy").toLowerCase();

      if (!flightIdInt || !["economy", "business", "first"].includes(normalizedClass)) {
        skipped++;
        continue;
      }

      // Kiểm tra flight còn active không
      const flightCheck = await pool.query(Q.FIND_ACTIVE_FLIGHT, [flightIdInt, normalizedClass]);
      if (flightCheck.rows.length === 0) {
        skipped++;
        continue;
      }

      // Insert, bỏ qua nếu đã có (ON CONFLICT DO NOTHING)
      // rowCount = 0 nghĩa là đã tồn tại → skipped, rowCount = 1 → synced mới
      const insertResult = await pool.query(Q.SYNC_WISHLIST_GUEST_TO_USER, [userId, flightIdInt, normalizedClass]);
      if (insertResult.rowCount > 0) {
        synced++;
      } else {
        skipped++; // Đã có trong wishlist rồi
      }
    } catch {
      skipped++;
    }
  }

  return {
    synced,
    skipped,
    message: `Đồng bộ thành công ${synced} chuyến bay${skipped > 0 ? `, bỏ qua ${skipped} mục không hợp lệ` : ""}`,
  };
};

module.exports = { addToWishlist, removeFromWishlist, getWishlist, syncWishlist };