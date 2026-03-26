const adminAirlineService = require("../services/admin.airline.service");

/** GET /api/admin/airlines */
const getAirlines = async (req, res) => {
  try {
    const result = await adminAirlineService.getAirlines(req.query);
    res.json({ message: "Lấy danh sách hãng bay thành công", ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** POST /api/admin/airlines */
const createAirline = async (req, res) => {
  try {
    const result = await adminAirlineService.createAirline(req.body);
    res.status(201).json({ message: "Thêm hãng bay thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** PUT /api/admin/airlines/:id */
const updateAirline = async (req, res) => {
  try {
    const result = await adminAirlineService.updateAirline(req.params.id, req.body);
    res.json({ message: "Cập nhật hãng bay thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** PATCH /api/admin/airlines/:id/status */
const updateAirlineStatus = async (req, res) => {
  try {
    const { is_active } = req.body;
    if (is_active === undefined) return res.status(400).json({ error: "is_active là bắt buộc" });
    const result = await adminAirlineService.updateAirlineStatus(req.params.id, is_active);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { getAirlines, createAirline, updateAirline, updateAirlineStatus };