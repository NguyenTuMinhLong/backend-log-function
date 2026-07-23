"use strict";

const wishlistService = require("../services/wishlist.service");

/**
 * POST /api/wishlist
 * CU-02: Thêm vào wishlist — CHỈ user đã login
 * Guest tự lưu vào localStorage (frontend xử lý)
 */
const addToWishlist = async (req, res) => {
  try {
    if (!req.user?.id) {
      // Trả về 401 để frontend biết cần lưu vào localStorage
      return res.status(401).json({
        error:      "Vui lòng đăng nhập để lưu chuyến bay",
        save_local: true,  // ← Flag để FE tự lưu localStorage
      });
    }

    const { flight_id, seat_class = "economy" } = req.body;
    if (!flight_id) return res.status(400).json({ error: "flight_id là bắt buộc" });

    const result = await wishlistService.addToWishlist(req.user.id, flight_id, seat_class);
    res.status(201).json(result);
  } catch (err) {
    const status = err.message.includes("đã có")          ? 409
                 : err.message.includes("không tồn tại")  ? 404
                 : err.message.includes("không hợp lệ")   ? 400
                 : 500;
    res.status(status).json({ error: err.message });
  }
};

/**
 * DELETE /api/wishlist
 * Xóa khỏi wishlist — CHỈ user đã login
 */
const removeFromWishlist = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        error:        "Vui lòng đăng nhập",
        remove_local: true, // ← Flag để FE tự xóa localStorage
      });
    }

    const { flight_id, seat_class = "economy" } = req.body;
    if (!flight_id) return res.status(400).json({ error: "flight_id là bắt buộc" });

    const result = await wishlistService.removeFromWishlist(req.user.id, flight_id, seat_class);
    res.json(result);
  } catch (err) {
    res.status(err.message.includes("Không tìm thấy") ? 404 : 400)
       .json({ error: err.message });
  }
};

/**
 * GET /api/wishlist
 * CU-04: Xem wishlist — CHỈ user đã login
 * Guest xem từ localStorage (frontend tự xử lý)
 */
const getWishlist = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({
        error:      "Vui lòng đăng nhập để xem danh sách yêu thích",
        read_local: true, // ← Flag để FE đọc localStorage
      });
    }

    const result = await wishlistService.getWishlist(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/wishlist/sync
 * CU-03: Sau khi đăng nhập → merge localStorage vào server
 * Body: { items: [{ flight_id, seat_class }, ...] }
 */
const syncWishlist = async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: "Cần đăng nhập" });

    const { items = [] } = req.body;
    const result = await wishlistService.syncWishlist(req.user.id, items);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { addToWishlist, removeFromWishlist, getWishlist, syncWishlist };