'use strict';

/*
=========================================================
ADMIN DATE CHANGE CONTROLLER
=========================================================
*/

const dateChangeService = require('../../services/date-change.service');
const QCD = require('../../queries/date-change.queries');
const pool = require('../../config/db');

/**
 * GET /api/admin/date-changes
 * Admin: Danh sách date changes (có filter)
 */
const getDateChanges = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 10,
      status,
      search,
      from_date,
      to_date,
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status) {
      conditions.push(`dcr.status = $${idx++}`);
      values.push(status);
    }
    if (search) {
      conditions.push(`(b.booking_code ILIKE $${idx} OR b.contact_email ILIKE $${idx} OR dcr.request_code ILIKE $${idx})`);
      idx++;
      values.push(`%${search}%`);
    }
    if (from_date) {
      conditions.push(`DATE(dcr.created_at) >= $${idx++}`);
      values.push(from_date);
    }
    if (to_date) {
      conditions.push(`DATE(dcr.created_at) <= $${idx++}`);
      values.push(to_date);
    }

    const dk = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const [dataResult, countResult] = await Promise.all([
      pool.query(QCD.SELECT_DATE_CHANGES_ADMIN(dk, idx, idx + 1), [...values, parseInt(limit), offset]),
      pool.query(QCD.COUNT_DATE_CHANGES_ADMIN(dk), values),
    ]);

    const total = parseInt(countResult.rows[0].count);

    res.json({
      message: 'Lấy danh sách đổi ngày bay thành công',
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
 * GET /api/admin/date-changes/pending
 * Admin: Danh sách date changes đang chờ duyệt
 */
const getPendingDateChanges = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const [dataResult, countResult] = await Promise.all([
      pool.query(QCD.SELECT_PENDING_DATE_CHANGES, [parseInt(limit), offset]),
      pool.query(QCD.COUNT_PENDING_DATE_CHANGES),
    ]);

    const total = parseInt(countResult.rows[0].count);

    res.json({
      message: 'Lấy danh sách đổi ngày bay chờ xử lý thành công',
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
 * GET /api/admin/date-changes/:requestCode
 * Admin: Chi tiết date change
 */
const getDateChangeDetail = async (req, res) => {
  try {
    const requestCode = req.params.requestCode.toUpperCase();
    const result = await dateChangeService.getDateChangeDetail(requestCode);

    res.json({
      message: 'Lấy chi tiết đổi ngày bay thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 500;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/admin/date-changes/:requestCode/approve
 * Admin: Duyệt date change
 */
const approveDateChange = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const requestCode = req.params.requestCode.toUpperCase();
    const { admin_notes } = req.body;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await dateChangeService.approveDateChange(adminId, requestCode, admin_notes);

    res.json({
      message: 'Duyệt đổi ngày bay thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * POST /api/admin/date-changes/:requestCode/reject
 * Admin: Từ chối date change
 */
const rejectDateChange = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const requestCode = req.params.requestCode.toUpperCase();
    const { reason } = req.body;

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!reason) {
      return res.status(400).json({ error: 'Vui lòng nhập lý do từ chối' });
    }

    const result = await dateChangeService.rejectDateChange(adminId, requestCode, reason);

    res.json({
      message: 'Từ chối đổi ngày bay thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * DELETE /api/admin/date-changes/:requestCode
 * Admin: Hủy date change request
 */
const cancelDateChange = async (req, res) => {
  try {
    const adminId = req.user ? req.user.id : null;
    const requestCode = req.params.requestCode.toUpperCase();

    if (!adminId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await dateChangeService.cancelDateChangeRequest(null, requestCode);

    res.json({
      message: 'Hủy yêu cầu đổi ngày bay thành công',
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
  getDateChanges,
  getPendingDateChanges,
  getDateChangeDetail,
  approveDateChange,
  rejectDateChange,
  cancelDateChange,
};
