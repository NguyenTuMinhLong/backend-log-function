"use strict";

const flightBrandService = require("../services/flight-brand.service");

/**
 * GET /api/flights/brand-combinations
 * Gợi ý kết hợp hãng tối ưu cho khứ hồi
 *
 * Query params:
 *   departure_code, arrival_code   (bắt buộc)
 *   departure_date, return_date    (bắt buộc - YYYY-MM-DD)
 *   seat_class                     (mặc định: economy)
 *   adults, children, infants      (mặc định: 1,0,0)
 *   limit                          (mặc định: 5)
 */
const getBrandCombinations = async (req, res) => {
  try {
    const {
      departure_code, arrival_code,
      departure_date, return_date,
      seat_class = 'economy',
      adults = 1, children = 0, infants = 0,
      limit = 5,
    } = req.query;

    const result = await flightBrandService.getBrandCombinations({
      departure_code, arrival_code,
      departure_date, return_date,
      seat_class, adults, children, infants,
      limit,
    });

    res.json({
      message: "Gợi ý kết hợp hãng bay thành công",
      data: result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = { getBrandCombinations };