// src/services/flight.service.js
const pool = require('../config/db');

/**
 * Hàm chính gợi ý chuyến bay - Hybrid Recommendation (Full Optional)
 * 
 * Logic chi tiết:
 * - Nếu là User login     → Ưu tiên lịch sử cá nhân (60%) + Popular
 * - Nếu là Guest          → Chỉ lấy Popular
 * - Nếu có from/to        → Lọc theo tuyến bay cụ thể
 * - Nếu không có from/to  → General Mode (chuyến bay hot nhất toàn hệ thống)
 */
const recommendFlights = async ({ userId, fromAirport, toAirport, limit = 10 }) => {
    
    // Kiểm tra chế độ: general hay theo tuyến cụ thể
    const isGeneralMode = !fromAirport || !toAirport;
    
    console.log(`[Recommendation] ${isGeneralMode ? 'GENERAL MODE (không có from/to)' : `from=${fromAirport}, to=${toAirport}`}, userId=${userId || 'Guest'}`);

    let recommendations = [];

    // ====================  USER ĐÃ LOGIN → RECOMMEND THEO LỊCH SỬ ====================
    if (userId) {
        // Lấy tất cả chuyến bay user đã từng bay thành công
        const historyQuery = `
            SELECT DISTINCT outbound_flight_id 
            FROM bookings 
            WHERE user_id = $1 AND status = 'completed'`;

        const { rows: history } = await pool.query(historyQuery, [userId]);

        // Nếu user có lịch sử thì ưu tiên gợi ý tuyến bay tương tự
        if (history.length > 0) {
            const flightIds = history.map(h => h.outbound_flight_id);

            let historyRecQuery;
            let params;

            if (isGeneralMode) {
                // GENERAL MODE: không lọc theo sân bay
                historyRecQuery = `
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
                    WHERE f.id != ALL($1)
                      AND f.status = 'scheduled'
                      AND f.is_active = true
                    ORDER BY f.departure_time ASC
                    LIMIT $2`;
                params = [flightIds, Math.floor(limit * 0.6)];
            } else {
                // MODE THEO TUYẾN: lọc theo from/to
                historyRecQuery = `
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
                    ORDER BY f.departure_time ASC
                    LIMIT $4`;
                params = [fromAirport, toAirport, flightIds, Math.floor(limit * 0.6)];
            }

            const { rows: historyRecs } = await pool.query(historyRecQuery, params);
            recommendations = [...historyRecs];
            
            console.log(`👤 [User ${userId}] Lấy ${historyRecs.length} chuyến theo lịch sử`);
        }
    }

    // ==================== RECOMMEND CHUYẾN BAY PHỔ BIẾN / HOT NHẤT ====================
    const remaining = limit - recommendations.length;
    if (remaining > 0) {
        let popularQuery;
        let params;

        if (isGeneralMode) {
            // GENERAL MODE: lấy hot nhất toàn hệ thống
            popularQuery = `
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
                GROUP BY f.id, a.name, dep.code, arr.code
                ORDER BY COUNT(b.id) DESC, f.departure_time ASC
                LIMIT $1`;
            params = [remaining];
        } else {
            // THEO TUYẾN: lấy popular trong tuyến đó
            popularQuery = `
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
            params = [fromAirport, toAirport, remaining];
        }

        const { rows: popular } = await pool.query(popularQuery, params);
        recommendations = [...recommendations, ...popular];
        
        console.log(`📊 Popular flights found: ${popular.length}`);
    }

    console.log(`✅ [Recommendation] Tổng recommendations: ${recommendations.length}`);

    // Trả về tối đa số lượng yêu cầu
    return recommendations.slice(0, limit);
};

module.exports = { recommendFlights };