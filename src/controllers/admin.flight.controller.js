const adminFlightService = require("../services/admin.flight.service");

/**
 * GET /api/admin/flights
 * Danh sách chuyến bay có filter + phân trang
 */
const getFlights = async (req, res) => {
  try {
    const result = await adminFlightService.getFlights(req.query);
    res.json({ message: "Lấy danh sách chuyến bay thành công", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * POST /api/admin/flights
 * Tạo chuyến bay mới
 */
const createFlight = async (req, res) => {
  try {
    const result = await adminFlightService.createFlight(req.body);
    res
      .status(201)
      .json({ message: "Tạo chuyến bay thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * PUT /api/admin/flights/:id
 * Cập nhật thông tin chuyến bay
 */
const updateFlight = async (req, res) => {
  try {
    const result = await adminFlightService.updateFlight(
      req.params.id,
      req.body,
    );
    res.json({ message: result.message, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * PATCH /api/admin/flights/:id/status
 * Chuyển trạng thái chuyến bay
 */
const updateFlightStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status là bắt buộc" });

    const result = await adminFlightService.updateFlightStatus(
      req.params.id,
      status,
    );
    res.json({ message: result.message, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * PATCH /api/admin/flights/:id/visibility
 * Ẩn/hiện chuyến bay (soft delete)
 */
const toggleFlightVisibility = async (req, res) => {
  try {
    const result = await adminFlightService.toggleFlightVisibility(
      req.params.id,
    );
    res.json({ message: result.message, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/admin/bookings
 * Danh sách booking có filter + phân trang
 */
const getBookings = async (req, res) => {
  try {
    const result = await adminFlightService.getBookings(req.query);
    res.json({ message: "Lấy danh sách booking thành công", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/admin/bookings/:id
 * Xem chi tiết booking
 */
const getBookingDetailAdmin = async (req, res) => {
  try {
    const result = await adminFlightService.getBookingDetailAdmin(
      req.params.id,
    );
    res.json({ message: "Lấy chi tiết booking thành công", data: result });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

/**
 * PATCH /api/admin/bookings/:id/status
 * Cập nhật trạng thái booking
 */
const updateBookingStatus = async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: "status là bắt buộc" });

    const result = await adminFlightService.updateBookingStatus(
      req.params.id,
      status,
    );
    res.json({ message: result.message, data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/admin/statistics
 * Báo cáo / thống kê
 */
const getStatistics = async (req, res) => {
  try {
    const result = await adminFlightService.getStatistics(req.query);
    res.json({ message: "Lấy thống kê thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  getFlights,
  createFlight,
  updateFlight,
  updateFlightStatus,
  toggleFlightVisibility,
  getBookings,
  getBookingDetailAdmin,
  updateBookingStatus,
  getStatistics,
};