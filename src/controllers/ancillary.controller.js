"use strict";

const ancillaryService = require("../services/ancillary.service");

/**
 * GET /api/ancillaries
 * Lấy danh sách tất cả dịch vụ bổ sung (grouped theo type)
 * Query: ?type=meal | baggage | insurance | lounge | wifi
 */
const getAncillaryOptions = async (req, res) => {
  try {
    const { type, lang } = req.query;
    const result = await ancillaryService.getAncillaryOptions(type || null, lang);
    res.json({
      message: "Lấy danh sách dịch vụ bổ sung thành công",
      data:    result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/:bookingCode/ancillaries
 * Xem dịch vụ bổ sung đã chọn của booking
 */
const getBookingAncillaries = async (req, res) => {
  try {
    const booking = await getBookingByCode(req.params.bookingCode);
    const result  = await ancillaryService.getBookingAncillaries(booking.id, req.query.lang);
    res.json({
      message: "Lấy danh sách dịch vụ bổ sung thành công",
      data:    result,
    });
  } catch (err) {
    res.status(err.message.includes("Không tìm thấy") ? 404 : 400)
       .json({ error: err.message });
  }
};

/**
 * POST /api/bookings/:bookingCode/ancillaries
 * Thêm dịch vụ bổ sung cho hành khách
 * Body: { passenger_id, ancillary_option_id, flight_type, quantity }
 */
const addAncillary = async (req, res) => {
  try {
    const booking = await getBookingByCode(req.params.bookingCode);

    // Chỉ booking đang pending mới thêm được
    if (!["pending", "confirmed"].includes(booking.status)) {
      return res.status(400).json({
        error: "Chỉ có thể thêm dịch vụ cho booking đang pending hoặc confirmed",
      });
    }

    const result = await ancillaryService.addAncillary(booking.id, req.body);
    res.status(201).json({
      message: result.message,
      data:    result,
    });
  } catch (err) {
    const status = err.message.includes("Không tìm thấy")  ? 404
                 : err.message.includes("đã chọn")         ? 409
                 : 400;
    res.status(status).json({ error: err.message });
  }
};

/**
 * DELETE /api/bookings/:bookingCode/ancillaries/:ancillaryId
 * Huỷ 1 dịch vụ bổ sung
 */
const removeAncillary = async (req, res) => {
  try {
    const booking = await getBookingByCode(req.params.bookingCode);
    const result  = await ancillaryService.removeAncillary(
      booking.id,
      req.params.ancillaryId
    );
    res.json({ message: result.message, data: result });
  } catch (err) {
    res.status(err.message.includes("Không tìm thấy") ? 404 : 400)
       .json({ error: err.message });
  }
};

/**
 * GET /api/bookings/:bookingCode/total
 * Tổng tiền booking + ancillaries
 */
const getBookingTotal = async (req, res) => {
  try {
    const booking = await getBookingByCode(req.params.bookingCode);
    const result  = await ancillaryService.getBookingTotal(booking.id);
    res.json({
      message: "Tính tổng tiền thành công",
      data:    result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

// ─── Helper ───────────────────────────────────────────────────────────────────

const pool = require("../config/db");

const getBookingByCode = async (bookingCode) => {
  const result = await pool.query(
    `SELECT id, status FROM bookings WHERE booking_code = $1`,
    [bookingCode.toUpperCase()]
  );
  if (result.rows.length === 0) throw new Error("Không tìm thấy booking");
  return result.rows[0];
};

module.exports = {
  getAncillaryOptions,
  getBookingAncillaries,
  addAncillary,
  removeAncillary,
  getBookingTotal,
};