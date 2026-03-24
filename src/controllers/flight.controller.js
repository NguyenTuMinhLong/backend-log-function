const flightService = require("../services/flight.service");

/**
 * NOTE:
 * GET /api/flights/search
 */
const searchFlights = async (req, res) => {
  try {
    const result = await flightService.searchFlights(req.query);
    res.json({
      message: "Tìm kiếm chuyến bay thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/flights/airports
 */
const getAirports = async (req, res) => {
  try {
    const airports = await flightService.getAirports();
    res.json({
      message: "Lấy danh sách sân bay thành công",
      data: airports,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/flights/airlines
 */
const getAirlines = async (req, res) => {
  try {
    const airlines = await flightService.getAirlines();
    res.json({
      message: "Lấy danh sách hãng hàng không thành công",
      data: airlines,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/flights/:id
 */
const getFlightById = async (req, res) => {
  try {
    const flight = await flightService.getFlightById(req.params.id);
    res.json({
      message: "Lấy thông tin chuyến bay thành công",
      data: flight,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

module.exports = { searchFlights, getAirports, getAirlines, getFlightById };