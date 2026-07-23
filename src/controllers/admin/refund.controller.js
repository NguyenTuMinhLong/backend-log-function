'use strict';

/*
=========================================================
ADMIN REFUND CONTROLLER
=========================================================
*/

const refundService = require('../../services/refund.service');
const QR = require('../../queries/refund.queries');
const pool = require('../../config/db');

/**
 * GET /api/admin/refunds
 * Admin: Danh sách refunds (có filter)
 */
const getRefunds = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      refund_type,
      search,
      from_date,
      to_date,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status) {
      conditions.push(`r.status = $${idx++}`);
      values.push(status);
    }
    if (refund_type) {
      conditions.push(`r.refund_type = $${idx++}`);
      values.push(refund_type);
    }
    if (search) {
      conditions.push(`(b.booking_code ILIKE $${idx} OR b.contact_email ILIKE $${idx} OR r.refund_code ILIKE $${idx})`);
      idx++;
      values.push(`%${search}%`);
    }
    if (from_date) {
      conditions.push(`DATE(r.created_at) >= $${idx++}`);
      values.push(from_date);
    }
    if (to_date) {
      conditions.push(`DATE(r.created_at) <= $${idx++}`);
      values.push(to_date);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataResult, countResult] = await Promise.all([
      pool.query(QR.SELECT_REFUNDS_ADMIN(whereClause, idx, idx + 1), [...values, parseInt(limit), offset]),
      pool.query(QR.COUNT_REFUNDS_ADMIN(whereClause), values),
    ]);

    const total = parseInt(countResult.rows[0].count);

    res.json({
      message: 'Lấy danh sách hoàn tiền thành công',
      data: dataResult.rows,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/admin/refunds/pending
 * Admin: Danh sách refunds đang chờ duyệt
 */
const getPendingRefunds = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [dataResult, countResult] = await Promise.all([
      pool.query(QR.SELECT_PENDING_REFUNDS, [parseInt(limit), offset]),
      pool.query(QR.COUNT_PENDING_REFUNDS),
    ]);

    const total = parseInt(countResult.rows[0].count);

    res.json({
      message: 'Lấy danh sách hoàn tiền chờ duyệt thành công',
      data: dataResult.rows,
      pending_count: total,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        total_pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/admin/refunds/:refundCode
 * Admin: Chi tiết refund
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
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 500;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/admin/refunds/:refundCode/approve
 * Admin: Duyệt refund
 */
const approveRefund = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const refundCode = req.params.refundCode.toUpperCase();
    const { admin_notes } = req.body;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await refundService.approveRefund(adminId, refundCode, admin_notes);

    res.json({
      message: 'Duyệt hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/admin/refunds/:refundCode/reject
 * Admin: Từ chối refund
 */
const rejectRefund = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const refundCode = req.params.refundCode.toUpperCase();
    const { reason } = req.body;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Vui lòng nhập lý do từ chối' });
    }

    const result = await refundService.rejectRefund(adminId, refundCode, reason);

    res.json({
      message: 'Từ chối hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/admin/refunds/:refundCode/complete
 * Admin: Hoàn thành refund (gọi payment gateway)
 */
const completeRefund = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const refundCode = req.params.refundCode.toUpperCase();

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await refundService.processRefund(adminId, refundCode);

    res.json({
      message: 'Hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/admin/refunds/:refundCode/cancel
 * Admin: Hủy refund request
 */
const cancelRefund = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const refundCode = req.params.refundCode.toUpperCase();
    const { reason } = req.body;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await refundService.cancelRefundRequest(null, refundCode, reason || 'Admin cancelled');

    res.json({
      message: 'Hủy yêu cầu hoàn tiền thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * GET /api/admin/refunds/stats
 * Admin: Thống kê refunds
 */
const getRefundStats = async (req, res) => {
  try {
    const { from_date, to_date } = req.query;

    const dateFilter = from_date && to_date
      ? `AND r.created_at BETWEEN '${from_date}' AND '${to_date}'`
      : '';

    const stats = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE r.status = 'pending') AS pending_count,
        COUNT(*) FILTER (WHERE r.status = 'approved') AS approved_count,
        COUNT(*) FILTER (WHERE r.status = 'completed') AS completed_count,
        COUNT(*) FILTER (WHERE r.status = 'rejected') AS rejected_count,
        COUNT(*) FILTER (WHERE r.status = 'failed') AS failed_count,
        COUNT(*) AS total_count,
        COALESCE(SUM(r.net_refund_amount) FILTER (WHERE r.status = 'completed'), 0) AS total_refunded_amount,
        COALESCE(AVG(r.net_refund_amount) FILTER (WHERE r.status = 'completed'), 0) AS avg_refund_amount
      FROM refunds r
      WHERE 1=1 ${dateFilter}
    `);

    res.json({
      message: 'Lấy thống kê hoàn tiền thành công',
      data: stats.rows[0],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  getRefunds,
  getPendingRefunds,
  getRefundDetail,
  approveRefund,
  rejectRefund,
  completeRefund,
  cancelRefund,
  getRefundStats,
};
