'use strict';

/*
=========================================================
REFUND CONTROLLER - User Endpoints
=========================================================
*/

const refundService = require('../services/refund.service');

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
// EXPORTS
// =========================================================

module.exports = {
  requestRefund,
  getBookingRefunds,
  getMyRefunds,
  getRefundDetail,
  cancelRefundRequest,
};
