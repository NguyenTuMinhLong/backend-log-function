// src/services/flight.service.js
const pool = require('../config/db');

const recommendFlights = async ({ userId, fromAirport, toAirport, limit = 15 }) => {
    console.log(`🔍 [Recommendation TEST] Lấy tất cả chuyến bay scheduled (bỏ filter from/to)`);

    const query = `
        SELECT 
            f.*,
            a.name as airline_name,
            dep.code as departure_code,
            arr.code as arrival_code,
            'Chuyến bay mới cập nhật' as reason
        FROM flights f
        JOIN airlines a ON f.airline_id = a.id
        JOIN airports dep ON f.departure_airport_id = dep.id
        JOIN airports arr ON f.arrival_airport_id = arr.id
        WHERE f.status = 'scheduled'
          AND f.is_active = true
        ORDER BY f.departure_time ASC
        LIMIT $1`;

    const { rows } = await pool.query(query, [limit]);

    console.log(`📊 [Recommendation] Tổng số chuyến bay tìm thấy: ${rows.length}`);

    return rows;
};

module.exports = { recommendFlights };