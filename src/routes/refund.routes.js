'use strict';

/*
=========================================================
REFUND ROUTES - User Endpoints
=========================================================
*/

const express = require('express');
const router = express.Router();
const refundController = require('../controllers/refund.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// User routes - phải đăng nhập
router.get('/my', authenticate, refundController.getMyRefunds);

// User routes - có thể xem không cần đăng nhập (với booking code)
router.get('/:refundCode', refundController.getRefundDetail);

// User hủy refund request
router.delete('/:refundCode', authenticate, refundController.cancelRefundRequest);

module.exports = router;
