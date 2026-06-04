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
 * ✅ Nhận thêm ?adults=2&children=1&infants=0 để tính đúng total_price
 */
const getFlightById = async (req, res) => {
  try {
    const { adults, children, infants } = req.query;
    const flight = await flightService.getFlightById(req.params.id, {
      adults: adults || 1,
      children: children || 0,
      infants: infants || 0,
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
    const {
      flight_id,
      seat_class = "economy",
      adults = 1,
      children = 0,
      infants = 0,
    } = req.query;
    if (!flight_id)
      return res.status(400).json({ error: "flight_id là bắt buộc" });

    const result = await flightService.getAlternativeFlights(flight_id, {
      seat_class,
      adults,
      children,
      infants,
    });
    res.json({ message: "Lấy chuyến bay thay thế thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/flights/combo
 * Tìm combo chuyến bay 1 chặng hoặc nối chuyến
 */
const getFlightCombos = async (req, res) => {
  try {
    const result = await flightService.getFlightCombos(req.query);
    res.json({ message: "Lấy combo chuyến bay thành công", data: result });
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
    const result = await flightService.getSeatMap(req.params.id, {
      seat_class,
    });
    res.json({ message: "Lấy sơ đồ ghế thành công", data: result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * GET /api/bookings/recommendations
 * 
 * Controller chính xử lý request 
 * 
 * - Trả về dữ liệu sạch, dễ render 3 card (HAN + SGN, giá, nút Chọn vé)
 */
const getFlightRecommendations = async (req, res) => {
  try {
    // Lấy tham số từ query string (?from=SGN&to=HAN&limit=10)
    const { from, to, limit = 10 } = req.query;

    // === LẤY USER ID (hỗ trợ cả đăng nhập JWT lẫn test qua query) ===
    const userId = req.user?.id || req.query.userId || null;

    // Validation
    if (!from || !to) {
      return res.status(400).json({ 
        error: "Thiếu tham số 'from' hoặc 'to' (mã sân bay)" 
      });
    }

    const recommendations = await flightService.recommendFlights({
      userId: userId,                    
      fromAirport: from.toUpperCase(),
      toAirport: to.toUpperCase(),
      limit: parseInt(limit) || 10
    });

    res.json({ 
      message: "Lấy gợi ý chuyến bay thành công", 
      data: recommendations 
    });
  } catch (err) {
    // Log lỗi chi tiết để debug
    console.error("[Flight Recommendation Controller] Error:", err);

    // Trả về lỗi server thân thiện với frontend
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy gợi ý chuyến bay. Vui lòng thử lại sau.",
      error: process.env.NODE_ENV === 'development' ? err.message : undefined,
    });
  }
};


/**
 * GET /api/flights/:id/position
 * Trả về vị trí hiện tại của máy bay theo flight ID
 */
const getFlightPosition = async (req, res) => {
  try {
    const { id } = req.params;

    // Kiểm tra id có phải số không
    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ error: "Flight ID không hợp lệ" });
    }

    const data = await flightService.getFlightPosition(Number(id));
    return res.json({ data });
  } catch (err) {
    if (err.message === "Không tìm thấy chuyến bay") {
      return res.status(404).json({ error: err.message });
    }
    console.error("[getFlightPosition]", err.message);
    return res.status(500).json({ error: "Lỗi server" });
  }
};

/**
 * ==========================================================
 * PRICE ALERT CONTROLLERS
 * ==========================================================
 */

/**
 * GET /api/flights/price-analysis?departure_date=2026-06-15&base_price=1000000&available_seats=50&total_seats=180
 * Phân tích giá dựa trên params (không cần flight ID)
 */
const getPriceAnalysis = async (req, res) => {
  try {
    const { departure_date, base_price, available_seats, total_seats } = req.query;

    // Validation
    if (!departure_date) {
      return res.status(400).json({ error: "departure_date là bắt buộc" });
    }
    if (!base_price || parseFloat(base_price) <= 0) {
      return res.status(400).json({ error: "base_price phải > 0" });
    }

    const { getDetailedAnalysis } = require('../services/price-alert.service');
    
    // Tạo flight object giả lập để phân tích
    const mockFlight = {
      id: null,
      departure_time: departure_date,
      base_price: parseFloat(base_price),
      available_seats: parseInt(available_seats) || 0,
      total_seats: parseInt(total_seats) || 1,
    };

    const analysis = await getDetailedAnalysis(mockFlight);
    
    res.json({
      message: "Phân tích giá thành công",
      data: analysis
    });
  } catch (err) {
    console.error("[getPriceAnalysis]", err.message);
    res.status(500).json({ error: err.message });
  }
};

/**
 * GET /api/flights/:id/price-analysis
 * Phân tích chi tiết giá cho một flight cụ thể
 */
const getFlightPriceAnalysis = async (req, res) => {
  try {
    const { id } = req.params;
    const { adults, children, infants } = req.query;

    if (!id || isNaN(Number(id))) {
      return res.status(400).json({ error: "Flight ID không hợp lệ" });
    }

    // Lấy flight từ DB
    const flight = await flightService.getFlightById(Number(id), {
      adults: adults || 1,
      children: children || 0,
      infants: infants || 0,
    });

    // Get detailed analysis
    const { getDetailedAnalysis } = require('../services/price-alert.service');
    const analysis = await getDetailedAnalysis(flight);

    res.json({
      message: "Phân tích giá thành công",
      data: analysis
    });
  } catch (err) {
    console.error("[getFlightPriceAnalysis]", err.message);
    if (err.message === "Không tìm thấy chuyến bay") {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  searchFlights,
  getAirports,
  getAirlines,
  getFlightById,
  getAlternativeFlights,
  getFlightCombos,
  getPriceCalendar,
  getSeatMap,
  getFlightRecommendations,
  getFlightPosition,
  // Price analysis exports
  getPriceAnalysis,
  getFlightPriceAnalysis,
  browseFlights: async (req, res) => {
    try {
      const limit = parseInt(req.query.limit) || 40;
      const data  = await flightService.browseFlights(limit);
      res.json({ data });
    } catch (err) {
      console.error('[Flight Browse]', err);
      res.status(500).json({ error: 'Lỗi server' });
    }
  },
};
