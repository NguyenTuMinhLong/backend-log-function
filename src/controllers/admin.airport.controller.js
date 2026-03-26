const adminAirportService = require("../services/admin.airport.service");

/** GET /api/admin/airports */
const getAirports = async (req, res) => {
  try {
    const result = await adminAirportService.getAirports(req.query);
    res.json({ message: "Lấy danh sách sân bay thành công", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** POST /api/admin/airports */
const createAirport = async (req, res) => {
  try {
    const result = await adminAirportService.createAirport(req.body);
    res.status(201).json({ message: "Thêm sân bay thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** PUT /api/admin/airports/:id */
const updateAirport = async (req, res) => {
  try {
    const result = await adminAirportService.updateAirport(req.params.id, req.body);
    res.json({ message: "Cập nhật sân bay thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** PATCH /api/admin/airports/:id/status */
const updateAirportStatus = async (req, res) => {
  try {
    const { is_active } = req.body;
    if (is_active === undefined) return res.status(400).json({ error: "is_active là bắt buộc" });
    const result = await adminAirportService.updateAirportStatus(req.params.id, is_active);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { getAirports, createAirport, updateAirport, updateAirportStatus };