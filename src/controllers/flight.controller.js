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

/**
 * GET /api/flights/alternatives?flight_id=&seat_class=&adults=&children=&infants=
 * SB-01: Gợi ý chuyến bay thay thế khi chuyến được chọn hết vé / không phù hợp
 */
const getAlternativeFlights = async (req, res) => {
  try {
    const { flight_id, seat_class = "economy", adults = 1, children = 0, infants = 0 } = req.query;
    if (!flight_id) return res.status(400).json({ error: "flight_id là bắt buộc" });

    const result = await flightService.getAlternativeFlights(flight_id, {
      seat_class, adults, children, infants,
    });
    res.json({ message: "Lấy chuyến bay thay thế thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/flights/price-calendar?from=HAN&to=SGN&month=2025-04&seat_class=economy&adults=1
 * SB-02: Lịch giá vé – giá thấp nhất mỗi ngày trong tháng
 */
const getPriceCalendar = async (req, res) => {
  try {
    const result = await flightService.getPriceCalendar(req.query);
    res.json({ message: "Lấy lịch giá vé thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/flights/:id/seat-map?seat_class=economy
 * SB-03: Xem sơ đồ ghế ngồi với trạng thái từng ghế
 */
const getSeatMap = async (req, res) => {
  try {
    const { seat_class } = req.query;
    const result = await flightService.getSeatMap(req.params.id, { seat_class });
    res.json({ message: "Lấy sơ đồ ghế thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { searchFlights, getAirports, getAirlines, getFlightById, getAlternativeFlights, getPriceCalendar, getSeatMap };