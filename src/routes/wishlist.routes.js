"use strict";

const express = require("express");
const router  = express.Router();

const { addToWishlist, removeFromWishlist, getWishlist, syncWishlist } = require("../controllers/wishlist.controller");
const { authenticateOptional, authenticate } = require("../middlewares/auth.middleware");

// CU-02: Thêm vào wishlist (user login hoặc guest)
router.post("/", authenticateOptional, addToWishlist);

// Xóa khỏi wishlist (user login hoặc guest)
router.delete("/", authenticateOptional, removeFromWishlist);

// CU-04: Xem wishlist (user login hoặc guest)
router.get("/", authenticateOptional, getWishlist);

// CU-03: Sync wishlist guest → user (phải đăng nhập)
router.post("/sync", authenticate, syncWishlist);

module.exports = router;
