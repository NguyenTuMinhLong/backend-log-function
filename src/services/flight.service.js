// src/services/flight.service.js
const pool = require('../config/db');

/**
 * Hàm chính gợi ý chuyến bay - Hybrid Recommendation
 * - User đã login → ưu tiên lịch sử cá nhân (60%)
 * - Guest hoặc không có lịch sử → recommend chuyến bay phổ biến nhất
 */
const recommendFlights = async ({ userId, fromAirport, toAirport, limit = 10 }) => {
    
    console.log(`🔍 [Recommendation] from=${fromAirport}, to=${toAirport}, userId=${userId || 'Guest'}`);

    let recommendations = [];

    // ==================== 1. USER ĐÃ LOGIN → RECOMMEND THEO LỊCH SỬ ====================
    if (userId) {
        // Lấy lịch sử bay của user (chỉ lấy outbound_flight_id)
        const historyQuery = `
            SELECT DISTINCT outbound_flight_id 
            FROM bookings 
            WHERE user_id = $1 AND status = 'completed'`;

        const { rows: history } = await pool.query(historyQuery, [userId]);

        // Nếu user có lịch sử bay
        if (history.length > 0) {
            const flightIds = history.map(h => h.outbound_flight_id);

            // Tìm những chuyến bay tương tự tuyến bay user hay đi
            const historyRecQuery = `
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
                  AND f.id != ALL($3)                    // Không lấy lại chuyến bay cũ
                  AND f.status = 'scheduled'
                  AND f.is_active = true
                ORDER BY f.departure_time ASC
                LIMIT $4`;

            const { rows: historyRecs } = await pool.query(historyRecQuery, [
                fromAirport, 
                toAirport, 
                flightIds,
                Math.floor(limit * 0.6)   // Lấy 60% từ lịch sử
            ]);

            recommendations = [...historyRecs];
            console.log(`[User ${userId}] Lấy ${historyRecs.length} chuyến theo lịch sử`);
        }
    }

    // ==================== 2. RECOMMEND CHUYẾN BAY PHỔ BIẾN NHẤT ====================
    const remaining = limit - recommendations.length;
    if (remaining > 0) {
        const popularQuery = `
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
            GROUP BY f.id, a.name, dep.code, arr.code
            ORDER BY COUNT(b.id) DESC, f.departure_time ASC
            LIMIT $3`;

        const { rows: popular } = await pool.query(popularQuery, [fromAirport, toAirport, remaining]);

        recommendations = [...recommendations, ...popular];
        console.log(`Popular flights found: ${popular.length}`);
    }

    console.log(`[Recommendation] Tổng recommendations: ${recommendations.length}`);

    // Trả về tối đa limit chuyến bay
    return recommendations.slice(0, limit);
};

module.exports = { recommendFlights };