'use strict';


// DATE CHANGE CONTROLLER - User + Admin

const dateChangeService = require('../services/date-change.service');

//  USER 

const requestDateChange = async (req, res) => {
  try {
    const userId = req.user?.id;
    const bookingCode = req.params.bookingCode?.toUpperCase();

    if (!userId) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để thực hiện yêu cầu đổi ngày bay' });
    }

    const result = await dateChangeService.requestDateChange(userId, bookingCode, req.body);

    res.status(201).json({
      message: 'Yêu cầu đổi ngày bay đã được gửi',
      data: result
    });
  } catch (err) {
    console.error(err);
    const status = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
};

const getBookingDateChanges = async (req, res) => {
  try {
    const bookingCode = req.params.bookingCode?.toUpperCase();
    const requests = await dateChangeService.getBookingDateChanges(bookingCode);

    res.json({
      message: 'Lấy danh sách yêu cầu đổi ngày bay thành công',
      data: requests,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getMyDateChanges = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

    const { page = 1, limit = 10 } = req.query;
    const result = await dateChangeService.getUserDateChanges(req.user.id, page, limit);

    res.json({
      message: 'Lấy lịch sử đổi ngày bay thành công',
      data: result.data,
      pagination: result.pagination,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getDateChangeDetail = async (req, res) => {
  try {
    const requestCode = req.params.requestCode?.toUpperCase();
    const result = await dateChangeService.getDateChangeDetail(requestCode);

    res.json({
      message: 'Lấy chi tiết yêu cầu thành công',
      data: result,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

const cancelDateChangeRequest = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });

    const requestCode = req.params.requestCode?.toUpperCase();
    const result = await dateChangeService.cancelDateChangeRequest(req.user.id, requestCode);

    res.json({
      message: 'Hủy yêu cầu thành công',
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ADMIN 

const approveDateChange = async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ error: 'Vui lòng đăng nhập với quyền Admin' });

    const requestCode = req.params.requestCode?.toUpperCase();
    const { admin_notes } = req.body;

    const result = await dateChangeService.approveDateChange(adminId, requestCode, admin_notes);

    res.json({
      message: 'Duyệt yêu cầu đổi ngày bay thành công',
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const rejectDateChange = async (req, res) => {
  try {
    const adminId = req.user?.id;
    if (!adminId) return res.status(401).json({ error: 'Vui lòng đăng nhập với quyền Admin' });

    const requestCode = req.params.requestCode?.toUpperCase();
    const { reason } = req.body;

    const result = await dateChangeService.rejectDateChange(adminId, requestCode, reason);

    res.json({
      message: 'Từ chối yêu cầu đổi ngày bay thành công',
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ==================================================// CONFIRM DATE CHANGE (After OTP Verification)
// ==================================================
const confirmDateChange = async (req, res) => {
  try {
    const { email, otp, requestCode } = req.body;

    if (!email || !otp || !requestCode) {
      return res.status(400).json({ error: 'email, otp, requestCode la bat buoc' });
    }

    const result = await dateChangeService.confirmDateChange(email, otp, requestCode);
    res.json(result);
  } catch (err) {
    console.error('[ConfirmDateChange]', err.message);
    res.status(400).json({ error: err.message });
  }
};

const getAdminDateChanges = async (req, res) => {
  try {
    const { status = '', page = 1, limit = 15 } = req.query;
    const result = await dateChangeService.getAdminDateChanges(status, page, limit);
    res.json({ message: 'Lấy danh sách đổi ngày thành công', data: result });
  } catch (err) {
// ==================================================// DATE CHANGE PAYMENT ENDPOINTS
// ==================================================
const createDateChangePayment = async (req, res) => {
  try {
    const requestCode = req.params.requestCode?.toUpperCase();
    const { payment_method } = req.body;
    const userId = req.user?.id;

    if (!payment_method) {
      return res.status(400).json({ error: 'payment_method la bat buoc' });
    }

    const result = await dateChangeService.createDateChangePayment(requestCode, payment_method, userId);

    res.status(201).json({
      message: 'Tao thanh toan thanh cong',
      data: result,
    });
  } catch (err) {
    console.error('[CreateDateChangePayment]', err.message);
    const status = err.message.includes('Khong tim thay') ? 404 : 400;
    res.status(status).json({ error: err.message });
  }
};

const getDateChangePaymentStatus = async (req, res) => {
  try {
    const requestCode = req.params.requestCode?.toUpperCase();
    const result = await dateChangeService.getDateChangePaymentStatus(requestCode);

    res.json({
      message: 'Lay trang thai thanh toan thanh cong',
      data: result,
    });
  } catch (err) {
    console.error('[GetDateChangePaymentStatus]', err.message);
    res.status(404).json({ error: err.message });
  }
};

const cancelDateChangePayment = async (req, res) => {
  try {
    const requestCode = req.params.requestCode?.toUpperCase();
    const result = await dateChangeService.cancelDateChangePayment(requestCode);

    res.json({
      message: 'Huy thanh toan thanh cong',
      data: result,
    });
  } catch (err) {
    console.error('[CancelDateChangePayment]', err.message);
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  requestDateChange,
  getBookingDateChanges,
  getMyDateChanges,
  getDateChangeDetail,
  cancelDateChangeRequest,
  approveDateChange,
  rejectDateChange,
  confirmDateChange,
  getAdminDateChanges,
  createDateChangePayment,
  getDateChangePaymentStatus,
  cancelDateChangePayment,
};