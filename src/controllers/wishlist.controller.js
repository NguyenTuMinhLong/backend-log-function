"use strict";

const wishlistService = require("../services/wishlist.service");

/**
 * Xác định actor từ request (user login hoặc guest)
 */
const resolveActor = (req) => {
  if (req.user?.id) {
    return { kind: "user", userId: req.user.id };
  }

  const guestSessionId = String(req.headers["x-guest-session"] || req.body?.guest_session_id || "").trim();
  if (!guestSessionId) throw new Error("Cần đăng nhập hoặc cung cấp guest_session_id");
  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(guestSessionId)) throw new Error("guest_session_id không hợp lệ");

  return { kind: "guest", guestSessionId };
};

/**
 * POST /api/wishlist
 * CU-02: Thêm chuyến bay vào danh sách yêu thích
 */
const addToWishlist = async (req, res) => {
  try {
    const actor      = resolveActor(req);
    const { flight_id, seat_class = "economy" } = req.body;

    if (!flight_id) return res.status(400).json({ error: "flight_id là bắt buộc" });

    const result = await wishlistService.addToWishlist(actor, flight_id, seat_class);
    res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes("không hợp lệ") || err.message.includes("bắt buộc") ? 400
                 : err.message.includes("đã có")       ? 409
                 : err.message.includes("không tồn tại") ? 404
                 : 500;
    res.status(status).json({ error: err.message });
  }
};

/**
 * DELETE /api/wishlist
 * Xóa chuyến bay khỏi danh sách yêu thích
 */
const removeFromWishlist = async (req, res) => {
  try {
    const actor      = resolveActor(req);
    const { flight_id, seat_class = "economy" } = req.body;

    if (!flight_id) return res.status(400).json({ error: "flight_id là bắt buộc" });

    const result = await wishlistService.removeFromWishlist(actor, flight_id, seat_class);
    res.json(result);
  } catch (err) {
    const status = err.message.includes("Không tìm thấy") ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
};

/**
 * GET /api/wishlist
 * CU-04: Xem danh sách yêu thích
 */
const getWishlist = async (req, res) => {
  try {
    const actor  = resolveActor(req);
    const result = await wishlistService.getWishlist(actor);
    res.json(result);
  } catch (err) {
        res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/wishlist/sync
 * CU-03: Đồng bộ wishlist guest → user sau khi đăng nhập
 */
const syncWishlist = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Cần đăng nhập" });

    const guestSessionId = String(req.body?.guest_session_id || "").trim();
    const result = await wishlistService.syncWishlist(req.user.id, guestSessionId);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { addToWishlist, removeFromWishlist, getWishlist, syncWishlist };