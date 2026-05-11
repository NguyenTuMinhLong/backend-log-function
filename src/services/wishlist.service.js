"use strict";

const pool = require("../config/db");
const Q    = require("../queries/wishlist.queries");

const VALID_CLASSES = ["economy", "business", "first"];

const formatItem = (row) => ({
  id:         row.id,
  seat_class: row.seat_class,
  added_at:   row.created_at,
  flight: {
    id:             row.flight_id,
    flight_number:  row.flight_number,
    departure_time: row.departure_time,
    arrival_time:   row.arrival_time,
    duration_minutes: row.duration_minutes,
    status:         row.flight_status,
    airline: {
      code:     row.airline_code,
      name:     row.airline_name,
      logo_url: row.logo_url,
    },
    departure: { code: row.dep_code, city: row.dep_city },
    arrival:   { code: row.arr_code, city: row.arr_city },
    base_price:      row.base_price      ? parseFloat(row.base_price)      : null,
    available_seats: row.available_seats ? parseInt(row.available_seats)   : null,
  },
});

/**
 * CU-02: Thêm chuyến bay vào wishlist
 * actor: { kind: "user", userId } | { kind: "guest", guestSessionId }
 */
const addToWishlist = async (actor, flightId, seatClass = "economy") => {
  const flightIdInt = parseInt(flightId, 10);
  if (!flightIdInt || flightIdInt <= 0) throw new Error("flight_id không hợp lệ");

  const normalizedClass = String(seatClass).toLowerCase();
  if (!VALID_CLASSES.includes(normalizedClass)) {
        throw new Error(`seat_class phải là: ${VALID_CLASSES.join(", ")}`);
  }

  // Kiểm tra flight có tồn tại không
  const flightResult = await pool.query(Q.FIND_ACTIVE_FLIGHT, [flightIdInt, normalizedClass]);
  if (flightResult.rows.length === 0) {
    throw new Error("Chuyến bay không tồn tại hoặc đã ngừng hoạt động");
  }

  if (actor.kind === "user") {
    const exists = await pool.query(Q.FIND_WISHLIST_BY_USER, [actor.userId, flightIdInt, normalizedClass]);
    if (exists.rows.length > 0) throw new Error("Chuyến bay đã có trong danh sách yêu thích");

    const result = await pool.query(Q.INSERT_WISHLIST_USER, [actor.userId, flightIdInt, normalizedClass]);
    return { message: "Đã thêm vào danh sách yêu thích", item: result.rows[0] };
  }

  // Guest
  const exists = await pool.query(Q.FIND_WISHLIST_BY_GUEST, [actor.guestSessionId, flightIdInt, normalizedClass]);
  if (exists.rows.length > 0) throw new Error("Chuyến bay đã có trong danh sách yêu thích");

  const result = await pool.query(Q.INSERT_WISHLIST_GUEST, [actor.guestSessionId, flightIdInt, normalizedClass]);
  return { message: "Đã thêm vào danh sách yêu thích", item: result.rows[0] };
};

/**
 * Xóa chuyến bay khỏi wishlist
 */
const removeFromWishlist = async (actor, flightId, seatClass = "economy") => {
  const flightIdInt     = parseInt(flightId, 10);
    const normalizedClass = String(seatClass).toLowerCase();

  let result;
  if (actor.kind === "user") {
    result = await pool.query(Q.DELETE_WISHLIST_BY_USER, [actor.userId, flightIdInt, normalizedClass]);
  } else {
    result = await pool.query(Q.DELETE_WISHLIST_BY_GUEST, [actor.guestSessionId, flightIdInt, normalizedClass]);
  }

  if (result.rows.length === 0) throw new Error("Không tìm thấy chuyến bay trong danh sách yêu thích");
  return { message: "Đã xóa khỏi danh sách yêu thích" };
};

/**
 * CU-04: Xem wishlist
 */
const getWishlist = async (actor) => {
  let result;
  if (actor.kind === "user") {
    result = await pool.query(Q.SELECT_WISHLIST_BY_USER, [actor.userId]);
  } else {
    result = await pool.query(Q.SELECT_WISHLIST_BY_GUEST, [actor.guestSessionId]);
  }

  return {
    total: result.rows.length,
    items: result.rows.map(formatItem),
  };
};

/**
 * CU-03: Sync wishlist từ guest → user sau khi đăng nhập
 */
const syncWishlist = async (userId, guestSessionId) => {
  if (!guestSessionId) return { synced: 0 };

  await pool.query(Q.SYNC_WISHLIST_GUEST_TO_USER, [userId, guestSessionId]);
  await pool.query(Q.DELETE_WISHLIST_BY_GUEST_SESSION, [guestSessionId]);

  return { message: "Đồng bộ wishlist thành công" };
};

module.exports = { addToWishlist, removeFromWishlist, getWishlist, syncWishlist };