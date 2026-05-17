'use strict';

/*
=========================================================
DATE CHANGE CONTROLLER - User Endpoints
=========================================================
*/

const dateChangeService = require('../services/date-change.service');

/**
 * POST /api/bookings/:bookingCode/change-flight
 * User yêu cầu đổi ngày bay
 */
const requestDateChange = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const bookingCode = req.params.bookingCode.toUpperCase();

    if (!userId) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập để thực hiện yêu cầu đổi ngày bay' });
    }

    const {
      new_flight_id,
      new_seat_class,
      passenger_ids,
      reason,
    } = req.body;

    const result = await dateChangeService.requestDateChange(userId, bookingCode, {
      new_flight_id,
      new_seat_class,
      passenger_ids,
      reason,
    });

    res.status(201).json({
      message: 'Yêu cầu đổi ngày bay đã được gửi',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/:bookingCode/date-changes
 * Xem danh sách date change requests của 1 booking
 */
const getBookingDateChanges = async (req, res) => {
  try {
    const bookingCode = req.params.bookingCode.toUpperCase();
    const requests = await dateChangeService.getBookingDateChanges(bookingCode);

    res.json({
      message: 'Lấy danh sách yêu cầu đổi ngày bay thành công',
      data: requests,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/date-changes/my
 * User xem lịch sử date change của mình
 */
const getMyDateChanges = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    }

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

/**
 * GET /api/date-changes/:requestCode
 * User xem chi tiết 1 date change request
 */
const getDateChangeDetail = async (req, res) => {
  try {
    const requestCode = req.params.requestCode.toUpperCase();
    const result = await dateChangeService.getDateChangeDetail(requestCode);

    res.json({
      message: 'Lấy chi tiết yêu cầu đổi ngày bay thành công',
      data: result,
    });
  } catch (err) {
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  }
};

/**
 * DELETE /api/date-changes/:requestCode
 * User hủy yêu cầu đổi ngày bay
 */
const cancelDateChangeRequest = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Vui lòng đăng nhập' });
    }

    const requestCode = req.params.requestCode.toUpperCase();
    const result = await dateChangeService.cancelDateChangeRequest(req.user.id, requestCode);

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
  requestDateChange,
  getBookingDateChanges,
  getMyDateChanges,
  getDateChangeDetail,
  cancelDateChangeRequest,
};
