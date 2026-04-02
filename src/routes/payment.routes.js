const express = require("express");
const router  = express.Router();
const {
  getMyPayments,
  previewPayment,
  createPayment,
  confirmPayment,
} = require("../controllers/payment.controller");
const { authenticate, authenticateOptional }  = require("../middlewares/auth.middleware");

router.post("/preview", authenticateOptional, previewPayment);
router.post("/", authenticateOptional, createPayment);
router.post("/:paymentCode/confirm", authenticateOptional, confirmPayment);
// GET /api/payments/my — lịch sử thanh toán của user
router.get("/my", authenticate, getMyPayments);

module.exports = router;
