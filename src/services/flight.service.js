// src/services/flight.service.js
const pool = require('../config/db');
const queries = require('../queries/flight.queries');   // ← import query

/**
 * Format chuyến bay trả về client
 */
const formatFlight = (row) => ({
  id: row.id,
  flight_number: row.flight_number,
  departure_time: row.departure_time,
  arrival_time: row.arrival_time,
  duration_minutes: row.duration_minutes,
  status: row.status,
  is_active: row.is_active,
  airline: {
    id: row.airline_id,
    name: row.airline_name,
  },
  departure: {
    id: row.departure_airport_id,
    code: row.departure_code,
  },
  arrival: {
    id: row.arrival_airport_id,
    code: row.arrival_code,
  },
  base_price: row.base_price ? parseFloat(row.base_price) : null,
  available_seats: row.available_seats ? parseInt(row.available_seats) : null,
  reason: row.reason,
});

/**
 * Lấy gợi ý dựa trên lịch sử bay của user
 */
const getHistoryRecommendations = async (userId, fromAirport, toAirport, limit) => {
  const historyRes = await pool.query(queries.GET_USER_BOOKED_FLIGHT_IDS, [userId]);

  if (historyRes.rows.length === 0) return [];

  const flightIds = historyRes.rows.map(r => r.outbound_flight_id);
  const isGeneralMode = !fromAirport || !toAirport;

  let query, params;

  if (isGeneralMode) {
    query = queries.GET_HISTORY_RECOMMENDATIONS_GENERAL;
    params = [flightIds, Math.floor(limit * 0.6)];
  } else {
    query = queries.GET_HISTORY_RECOMMENDATIONS_ROUTE;
    params = [fromAirport, toAirport, flightIds, Math.floor(limit * 0.6)];
  }

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Lấy chuyến bay phổ biến nhất
 */
const getPopularFlights = async (fromAirport, toAirport, limit) => {
  const isGeneralMode = !fromAirport || !toAirport;

  let query, params;

  if (isGeneralMode) {
    query = queries.GET_POPULAR_FLIGHTS_GENERAL;
    params = [limit];
  } else {
    query = queries.GET_POPULAR_FLIGHTS_ROUTE;
    params = [fromAirport, toAirport, limit];
  }

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Hàm chính: Gợi ý chuyến bay (Hybrid Recommendation)
 */
const recommendFlights = async ({ userId, fromAirport, toAirport, limit = 10 }) => {
  try {
    if (limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const isGeneralMode = !fromAirport || !toAirport;

    console.log(`[Recommendation] ${isGeneralMode ? 'GENERAL MODE' : `from=${fromAirport} → to=${toAirport}`}, user=${userId || 'Guest'}`);

    let recommendations = [];

    if (userId) {
      const historyRecs = await getHistoryRecommendations(userId, fromAirport, toAirport, limit);
      recommendations = [...historyRecs];
      console.log(`User ${userId} → ${historyRecs.length} chuyến từ lịch sử`);
    }

    const remaining = limit - recommendations.length;
    if (remaining > 0) {
      const popular = await getPopularFlights(fromAirport, toAirport, remaining);
      recommendations = [...recommendations, ...popular];
      console.log(`Popular → ${popular.length} chuyến`);
    }

    const formatted = recommendations.slice(0, limit).map(formatFlight);

    console.log(`Recommendation hoàn tất: ${formatted.length} chuyến`);
    return formatted;

  } catch (error) {
    console.error('[Recommendation Error]', error);
    throw new Error('Không thể lấy gợi ý chuyến bay lúc này. Vui lòng thử lại sau.');
  }
};

module.exports = { recommendFlights };