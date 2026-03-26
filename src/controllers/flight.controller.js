const flightService = require("../services/flight.service");

/** GET /api/flights/search */
const searchFlights = async (req, res) => {
  try {
    const result = await flightService.searchFlights(req.query);
    res.json({ message: "Tìm kiếm chuyến bay thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/** GET /api/flights/airports */
const getAirports = async (req, res) => {
  try {
    const airports = await flightService.getAirports();
    res.json({ message: "Lấy danh sách sân bay thành công", data: airports });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/** GET /api/flights/airlines */
const getAirlines = async (req, res) => {
  try {
    const airlines = await flightService.getAirlines();
    res.json({ message: "Lấy danh sách hãng hàng không thành công", data: airlines });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/flights/:id
 * ✅ Nhận thêm ?adults=2&children=1&infants=0 để tính đúng total_price
 */
const getFlightById = async (req, res) => {
  try {
    const { adults, children, infants } = req.query;
    const flight = await flightService.getFlightById(req.params.id, {
      adults:   adults   || 1,
      children: children || 0,
      infants:  infants  || 0,
    });
    res.json({ message: "Lấy thông tin chuyến bay thành công", data: flight });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

module.exports = { searchFlights, getAirports, getAirlines, getFlightById };