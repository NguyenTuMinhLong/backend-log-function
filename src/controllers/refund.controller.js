'use strict';

/*
=========================================================
REFUND CONTROLLER - User Endpoints
=========================================================
*/

const refundService = require('../services/refund.service');

// =========================================================
// HELPERS
// =========================================================

const sanitizeGuestSessionId = (sessionId) => {
  if (!sessionId || typeof sessionId !== 'string') return null;
  // Validate format: alphanumeric with underscore/hyphen, 12-120 chars
  const sanitized = sessionId.trim().substring(0, 120);
  if (!/^[a-zA-Z0-9_-]{12,120}$/.test(sanitized)) return null;
  return sanitized;
};

const getGuestSessionId = (req) => {
  return sanitizeGuestSessionId(req.headers['x-guest-session']);
};

/**
 * POST /api/bookings/:bookingCode/refund
 * User yêu cầu hoàn tiền
 */
const requestRefund = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const bookingCode = req.params.bookingCode.toUpperCase();

    if (!userId) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để thực hiện yêu cầu hoàn tiền' });
    }

    const {
      refund_type = 'full',
      requested_items,
      reason,
      user_notes,
    } = req.body;

    const result = await refundService.requestRefund(userId, bookingCode, {
      refund_type,
      requested_items,
      reason,
      user_notes,
    });

    res.status(201).json({
      message: 'Yêu cầu hoàn tiền đã được gửi',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/:bookingCode/refunds
 * Xem danh sách refunds của 1 booking
 */
const getBookingRefunds = async (req, res) => {
  try {
    const bookingCode = req.params.bookingCode.toUpperCase();
    const refunds = await refundService.getBookingRefunds(bookingCode);

    res.json({
      message: 'Lấy danh sách hoàn tiền thành công',
      data: refunds,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/refunds/my
 * User xem lịch sử refund của mình
 */
const getMyRefunds = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    }

    const { page = 1, limit = 10 } = req.query;
    const result = await refundService.getUserRefunds(req.user.id, page, limit);

    res.json({
      message: 'Lấy lịch sử hoàn tiền thành công',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/refunds/:refundCode
 * User xem chi tiết 1 refund
 */
const getRefundDetail = async (req, res) => {
  try {
    const refundCode = req.params.refundCode.toUpperCase();
    const result = await refundService.getRefundDetail(refundCode);

    res.json({
      message: 'Lấy chi tiết hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * DELETE /api/refunds/:refundCode
 * User hủy yêu cầu refund (chỉ pending/approved)
 */
const cancelRefundRequest = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    }

    const refundCode = req.params.refundCode.toUpperCase();
    const { reason } = req.body;

    const result = await refundService.cancelRefundRequest(req.user.id, refundCode, reason);

    res.json({
      message: 'Hủy yêu cầu hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

// =========================================================
// GUEST CONTROLLERS
// =========================================================

/**
 * POST /api/refunds/guest
 * Guest yêu cầu hoàn tiền (không cần đăng nhập)
 * Body: { bookingCode, guestEmail, refund_type, requested_items, reason, user_notes }
 * Header: x-guest-session (optional) - guest session ID for tracking
 */
const requestGuestRefund = async (req, res) => {
  try {
    const {
      bookingCode,
      guestEmail,
      refund_type = 'full',
      requested_items,
      reason,
      user_notes,
    } = req.body;

    // Validate required fields
    if (!bookingCode) {
      return res.status(400).json({ error: 'Mã booking là bắt buộc' });
    }
    if (!guestEmail) {
      return res.status(400).json({ error: 'Email xác thực là bắt buộc' });
    }
    if (!reason) {
      return res.status(400).json({ error: 'Lý do yêu cầu là bắt buộc' });
    }

    // Get optional guest session ID for tracking
    const guestSessionId = getGuestSessionId(req);

    const result = await refundService.requestGuestRefund(
      bookingCode.toUpperCase(),
      guestEmail,
      { refund_type, requested_items, reason, user_notes },
      { guestSessionId }
    );

    res.status(201).json({
      message: 'Yêu cầu hoàn tiền đã được tiếp nhận. Vui lòng lưu mã yêu cầu để theo dõi.',
      data: result,
    });
  } catch (err) {
    console.error('[GuestRefund]', err.message);
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * GET /api/refunds/guest/:refundCode
 * Guest xem chi tiết refund (cần verify email)
 * Query: ?email=guest@email.com
 */
const getGuestRefundDetail = async (req, res) => {
  try {
    const refundCode = req.params.refundCode.toUpperCase();
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email xác thực là bắt buộc' });
    }

    const result = await refundService.getGuestRefundDetail(refundCode, email);

    res.json({
      message: 'Lấy chi tiết hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    console.error('[GuestRefundDetail]', err.message);
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/refunds/link-guest-refunds
 * User đăng nhập → link guest refunds với account
 * Body: { guestEmail, guestSessionId }
 * Cần đăng nhập (authenticate middleware)
 */
const linkGuestRefunds = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    }

    const { guestEmail, guestSessionId } = req.body;

    if (!guestEmail && !guestSessionId) {
      return res.status(400).json({
        error: 'Cần cung cấp guestEmail hoặc guestSessionId để link refunds'
      });
    }

    const result = await refundService.linkGuestRefundsToUser(
      req.user.id,
      guestEmail,
      sanitizeGuestSessionId(guestSessionId)
    );

    res.json({
      message: `Đã link ${result.count} refunds với tài khoản của bạn`,
      data: result,
    });
  } catch (err) {
    console.error('[LinkGuestRefunds]', err.message);
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/refunds/guest/cancel
 * Guest hủy yêu cầu refund của mình (không cần đăng nhập)
 * Body: { refundCode, guestEmail }
 */
const cancelGuestRefund = async (req, res) => {
  try {
    const { refundCode, guestEmail } = req.body;

    if (!refundCode) {
      return res.status(400).json({ error: 'Mã refund là bắt buộc' });
    }
    if (!guestEmail) {
      return res.status(400).json({ error: 'Email xác thực là bắt buộc' });
    }

    const result = await refundService.cancelGuestRefundRequest(
      refundCode.toUpperCase(),
      guestEmail
    );

    res.json({
      message: 'Hủy yêu cầu hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    console.error('[CancelGuestRefund]', err.message);
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  requestRefund,
  getBookingRefunds,
  getMyRefunds,
  getRefundDetail,
  cancelRefundRequest,
  // Guest
  requestGuestRefund,
  getGuestRefundDetail,
  linkGuestRefunds,
  cancelGuestRefund,
};
