'use strict';

/*
=========================================================
REFUND ROUTES - User & Guest Endpoints
=========================================================
*/

const express = require('express');
const router = express.Router();
const refundController = require('../controllers/refund.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// =========================================================
// IN-MEMORY RATE LIMITER (Simple implementation)
// =========================================================

const rateLimitStore = new Map();

const rateLimiter = (options = {}) => {
  const { windowMs = 15 * 60 * 1000, max = 5 } = options;

  return (req, res, next) => {
    const key = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Get or initialize request log
    let requestLog = rateLimitStore.get(key) || [];

    // Filter out old requests outside the window
    requestLog = requestLog.filter(timestamp => timestamp > windowStart);

    if (requestLog.length >= max) {
      const retryAfter = Math.ceil((requestLog[0] + windowMs - now) / 1000);
      res.set('Retry-After', retryAfter);
      return res.status(429).json({
        error: 'Quá nhiều yêu cầu, vui lòng thử lại sau',
        retryAfter
      });
    }

    // Add current request
    requestLog.push(now);
    rateLimitStore.set(key, requestLog);
    next();
  };
};

// Cleanup old entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  const windowMs = 30 * 60 * 1000;
  for (const [key, timestamps] of rateLimitStore.entries()) {
    const filtered = timestamps.filter(t => t > now - windowMs);
    if (filtered.length === 0) {
      rateLimitStore.delete(key);
    } else {
      rateLimitStore.set(key, filtered);
    }
  }
}, 5 * 60 * 1000);

// =========================================================
// GUEST ROUTES (Không cần đăng nhập, có rate limit)
// =========================================================

const guestRateLimiter = rateLimiter({ windowMs: 1 * 60 * 1000, max: 3 });

/**
 * POST /api/refund/guest
 * Yêu cầu refund từ guest
 * Body: { bookingCode, guestEmail, refund_type, requested_items, reason, user_notes }
 */
router.post('/guest', guestRateLimiter, refundController.requestGuestRefund);

/**
 * POST /api/refund/guest/cancel
 * Guest hủy yêu cầu refund của mình
 * Body: { refundCode, guestEmail }
 */
router.post('/guest/cancel', guestRateLimiter, refundController.cancelGuestRefund);

/**
 * GET /api/refund/guest/:refundCode
 * Xem chi tiết refund của guest (cần verify email)
 * Query: ?email=guest@email.com
 */
router.get('/guest/:refundCode', guestRateLimiter, refundController.getGuestRefundDetail);

/**
 * POST /api/refund/guest/request-otp
 * Yêu cầu gửi mã OTP đến email (khi refund amount > threshold)
 * Body: { email, bookingCode }
 */
router.post('/guest/request-otp', guestRateLimiter, refundController.requestGuestOTP);

/**
 * POST /api/refund/guest/verify-otp
 * Verify OTP để tạo refund (khi refund amount > threshold)
 * Body: { email, code }
 */
router.post('/guest/verify-otp', guestRateLimiter, refundController.verifyGuestOTP);

/**
 * GET /api/refund/guest/otp-status
 * Kiểm tra trạng thái OTP
 * Query: ?email=xxx
 */
router.get('/guest/otp-status', refundController.getOTPStatus);

// =========================================================
// USER ROUTES (Cần đăng nhập)
// =========================================================

/**
 * POST /api/refund/user/request-otp
 * User (logged in) yêu cầu gửi mã OTP đến email (khi bill amount > threshold)
 * Body: { bookingCode }
 * Headers: { Authorization: Bearer <token> }
 */
router.post('/user/request-otp', authenticate, refundController.requestUserOTP);

// User xem danh sách refund của mình
router.get('/my', authenticate, refundController.getMyRefunds);

// User xem chi tiết refund (của mình)
router.get('/:refundCode', refundController.getRefundDetail);

// User hủy refund request
router.delete('/:refundCode', authenticate, refundController.cancelRefundRequest);

// User link guest refunds với account của mình (sau khi đăng nhập)
router.post('/link-guest-refunds', authenticate, refundController.linkGuestRefunds);

module.exports = router;
