"use strict";

const express = require("express");
const router  = express.Router();

const {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  syncWishlist,
} = require("../controllers/wishlist.controller");
const { authenticateOptional, authenticate } = require("../middlewares/auth.middleware");

// CU-02: Thêm vào wishlist
// authenticateOptional để controller tự kiểm tra và trả flag save_local nếu là guest
router.post("/",       authenticateOptional, addToWishlist);

// Xóa khỏi wishlist
router.delete("/",     authenticateOptional, removeFromWishlist);

// CU-04: Xem wishlist
router.get("/",        authenticateOptional, getWishlist);

// CU-03: Sync localStorage → server (bắt buộc đăng nhập)
router.post("/sync",   authenticate,         syncWishlist);

module.exports = router;