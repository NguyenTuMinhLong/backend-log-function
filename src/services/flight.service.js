// src/services/flight.service.js
const pool = require('../config/db');

/**
 * Format chuyến bay trả về client
 * 
 * - Trả về đầy đủ thông tin cần thiết để render: tuyến bay, giá, thời gian, reason
 */
const formatFlight = (row) => ({
  id: row.id,                                   // ID chuyến bay (dùng cho link chi tiết hoặc chọn vé)
  flight_number: row.flight_number,             // Mã chuyến bay 
  departure_time: row.departure_time,           // Thời gian khởi hành 
  arrival_time: row.arrival_time,               // Thời gian đến
  duration_minutes: row.duration_minutes,       // Thời lượng bay (phút)
  status: row.status,
  is_active: row.is_active,
  airline: {
    id: row.airline_id,
    name: row.airline_name,                     // Tên hãng bay (dùng để hiển thị logo hoặc tên)
  },
  departure: {
    id: row.departure_airport_id,
    code: row.departure_code,                   // Mã sân bay đi (HAN, SGN...)
  },
  arrival: {
    id: row.arrival_airport_id,
    code: row.arrival_code,                     // Mã sân bay đến
  },
  base_price: row.base_price ? parseFloat(row.base_price) : null,   // Giá cơ bản (định dạng số cho Figma)
  available_seats: row.available_seats ? parseInt(row.available_seats) : null,
  reason: row.reason,                           // Lý do gợi ý: "Tuyến bay bạn hay đi" hoặc "Chuyến bay hot nhất"
});

/**
 * Lấy gợi ý dựa trên lịch sử bay của user (60% ưu tiên)
 * - Chỉ chạy khi user đã login
 */
const getHistoryRecommendations = async (userId, fromAirport, toAirport, limit) => {
  // Bước 1: Lấy tất cả chuyến bay user đã bay thành công (distinct flight_id)
  const historyRes = await pool.query(
    `SELECT DISTINCT outbound_flight_id 
     FROM bookings 
     WHERE user_id = $1 AND status = 'completed'`,
    [userId]
  );

  // Nếu user chưa có lịch sử → không có gợi ý từ history
  if (historyRes.rows.length === 0) return [];

  const flightIds = historyRes.rows.map(r => r.outbound_flight_id);
  const isGeneralMode = !fromAirport || !toAirport;

  let query;
  let params;

  if (isGeneralMode) {
    // GENERAL MODE: không có from/to → gợi ý chuyến bay tương tự toàn hệ thống
    query = `
      SELECT 
        f.*,
        a.name as airline_name,
        dep.code as departure_code,
        arr.code as arrival_code,
        'Tuyến bay bạn hay đi' as reason
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      JOIN airports dep ON f.departure_airport_id = dep.id
      JOIN airports arr ON f.arrival_airport_id = arr.id
      WHERE f.id != ALL($1)                    -- loại trừ chuyến bay user đã bay
        AND f.status = 'scheduled'
        AND f.is_active = true
        AND f.departure_time > NOW()           -- chỉ lấy chuyến bay tương lai
      ORDER BY f.departure_time ASC
      LIMIT $2`;
    params = [flightIds, Math.floor(limit * 0.6)];
  } else {
    // MODE THEO TUYẾN: có from & to → gợi ý cùng tuyến bay
    query = `
      SELECT 
        f.*,
        a.name as airline_name,
        dep.code as departure_code,
        arr.code as arrival_code,
        'Tuyến bay bạn hay đi' as reason
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      JOIN airports dep ON f.departure_airport_id = dep.id
      JOIN airports arr ON f.arrival_airport_id = arr.id
      WHERE dep.code = $1 
        AND arr.code = $2
        AND f.id != ALL($3)
        AND f.status = 'scheduled'
        AND f.is_active = true
        AND f.departure_time > NOW()
      ORDER BY f.departure_time ASC
      LIMIT $4`;
    params = [fromAirport, toAirport, flightIds, Math.floor(limit * 0.6)];
  }

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Lấy chuyến bay phổ biến nhất (popular) để bổ sung
 * - Dùng khi user chưa có lịch sử hoặc cần thêm item
 */
const getPopularFlights = async (fromAirport, toAirport, limit) => {
  const isGeneralMode = !fromAirport || !toAirport;

  let query;
  let params;

  if (isGeneralMode) {
    // GENERAL MODE: hot nhất toàn hệ thống
    query = `
      SELECT 
        f.*,
        a.name as airline_name,
        dep.code as departure_code,
        arr.code as arrival_code,
        'Chuyến bay hot nhất' as reason
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      JOIN airports dep ON f.departure_airport_id = dep.id
      JOIN airports arr ON f.arrival_airport_id = arr.id
      LEFT JOIN bookings b ON b.outbound_flight_id = f.id
      WHERE f.status = 'scheduled'
        AND f.is_active = true
        AND f.departure_time > NOW()
      GROUP BY f.id, a.name, dep.code, arr.code
      ORDER BY COUNT(b.id) DESC, f.departure_time ASC
      LIMIT $1`;
    params = [limit];
  } else {
    // THEO TUYẾN: popular trong tuyến bay cụ thể
    query = `
      SELECT 
        f.*,
        a.name as airline_name,
        dep.code as departure_code,
        arr.code as arrival_code,
        'Chuyến bay phổ biến nhất' as reason
      FROM flights f
      JOIN airlines a ON f.airline_id = a.id
      JOIN airports dep ON f.departure_airport_id = dep.id
      JOIN airports arr ON f.arrival_airport_id = arr.id
      LEFT JOIN bookings b ON b.outbound_flight_id = f.id
      WHERE dep.code = $1 
        AND arr.code = $2
        AND f.status = 'scheduled'
        AND f.is_active = true
        AND f.departure_time > NOW()
      GROUP BY f.id, a.name, dep.code, arr.code
      ORDER BY COUNT(b.id) DESC, f.departure_time ASC
      LIMIT $3`;
    params = [fromAirport, toAirport, limit];
  }

  const { rows } = await pool.query(query, params);
  return rows;
};

/**
 * Hàm chính: Gợi ý chuyến bay (Hybrid Recommendation)
 * - Hỗ trợ cả User và Guest
 * - Hỗ trợ General Mode & Route-specific Mode
 * - Đã tối ưu cho Figma CU-05
 */
const recommendFlights = async ({ userId, fromAirport, toAirport, limit = 10 }) => {
  try {
    // Giới hạn hợp lý để tránh overload
    if (limit < 1) limit = 10;
    if (limit > 50) limit = 50;

    const isGeneralMode = !fromAirport || !toAirport;

    console.log(`[Recommendation] ${isGeneralMode ? 'GENERAL MODE' : `from=${fromAirport} → to=${toAirport}`}, user=${userId || 'Guest'}`);

    let recommendations = [];

    // Ưu tiên lịch sử cá nhân nếu là User đã login
    if (userId) {
      const historyRecs = await getHistoryRecommendations(userId, fromAirport, toAirport, limit);
      recommendations = [...historyRecs];
      console.log(`User ${userId} → ${historyRecs.length} chuyến từ lịch sử`);
    }

    // Bổ sung popular flights để đủ số lượng
    const remaining = limit - recommendations.length;
    if (remaining > 0) {
      const popular = await getPopularFlights(fromAirport, toAirport, remaining);
      recommendations = [...recommendations, ...popular];
      console.log(`Popular → ${popular.length} chuyến`);
    }

    // Format theo cấu trúc Figma cần và cắt đúng limit
    const formatted = recommendations.slice(0, limit).map(formatFlight);

    console.log(`Recommendation hoàn tất: ${formatted.length} chuyến`);
    return formatted;

  } catch (error) {
    console.error('[Recommendation Error]', error);
    throw new Error('Không thể lấy gợi ý chuyến bay lúc này. Vui lòng thử lại sau.');
  }
};

module.exports = { recommendFlights };