const bookingService = require("../services/booking.service");

/**
 * POST /api/bookings
 * Tạo booking mới (guest hoặc user đã login)
 */
const createBooking = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await bookingService.createBooking(req.body, userId);

    res.status(201).json({
      message: "Đặt vé thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/:bookingCode
 * Xem chi tiết booking theo mã PNR
 * - Guest: xem được nếu biết mã
 * - User login: chỉ xem được booking của mình
 */
const getBookingDetail = async (req, res) => {
  try {
    const userId = req.user ? req.user.id : null;
    const result = await bookingService.getBookingDetail(
      req.params.bookingCode.toUpperCase(),
      userId,
    );

    res.json({
      message: "Lấy thông tin booking thành công",
      data: result,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/my
 * Lịch sử booking của user đã đăng nhập
 */
const getMyBookings = async (req, res) => {
  try {
    const filter = req.query.filter || "all";
    const data = await bookingService.getMyBookings(req.user.id, filter);

    res.json({
      message: "Lấy lịch sử chuyến bay thành công",
      filter,
      total: data.length,
      data,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/bookings/:bookingCode/cancel
 * Hủy booking - chỉ user đã đăng nhập mới được hủy
 */
const cancelBooking = async (req, res) => {
  try {
    const bookingCode = req.params.bookingCode.toUpperCase();
    const result = await bookingService.cancelBooking(req.user.id, bookingCode);

    res.json({
      message: "Hủy booking thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  createBooking,
  getBookingDetail,
  getMyBookings,
  cancelBooking,
};
