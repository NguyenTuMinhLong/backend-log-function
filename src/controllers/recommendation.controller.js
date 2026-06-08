"use strict";

/**
 * Recommendation Controller — CU-05
 * GET /api/recommendations
 */
const recommendationService = require("../services/recommendation.service");

const getRecommendations = async (req, res) => {
  try {
    const { months = 3, limit = 1000 } = req.query;

    const userId = req.user?.id || null;
    const sessionId = req.headers["x-session-id"] || null;

    const result = await recommendationService.getRecommendations({
      userId,
      sessionId,
      monthsAhead: parseInt(months, 10) || 3,
      limit: parseInt(limit, 10) || 1000,
    });

    res.json({
      message: "Lấy gợi ý chuyến bay thành công",
      data: result,
    });
  } catch (err) {
    console.error("[Recommendation Controller] Error:", err);
    res.status(500).json({
      success: false,
      message: "Lỗi server khi lấy gợi ý. Vui lòng thử lại sau.",
      error: process.env.NODE_ENV === "development" ? err.message : undefined,
    });
  }
};

module.exports = { getRecommendations };
