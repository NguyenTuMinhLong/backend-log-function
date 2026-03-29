const express = require("express");
const router  = express.Router();
const { getMyPayments } = require("../controllers/payment.controller");
const { authenticate }  = require("../middlewares/auth.middleware");

// GET /api/payments/my — lịch sử thanh toán của user
router.get("/my", authenticate, getMyPayments);

module.exports = router;