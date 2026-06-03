// Seed lại dữ liệu test cho mixed-search
require('dotenv').config();
const pool = require('../src/config/db');

const seed = async () => {
  const client = await pool.connect();
  
  try {
    // Lấy airport IDs
    const airports = await client.query(`SELECT id, code FROM airports WHERE code IN ('HAN', 'SGN', 'DAD')`);
    const airportMap = {};
    airports.rows.forEach(r => airportMap[r.code] = r.id);
    console.log('Airports:', airportMap);

    // Lấy airline IDs
    const airlines = await client.query(`SELECT id, code FROM airlines WHERE code IN ('VN', 'VJ', 'QH')`);
    const airlineMap = {};
    airlines.rows.forEach(r => airlineMap[r.code] = r.id);
    console.log('Airlines:', airlineMap);

    // Tạo flights cho ngày 2026-06-10
    const flightData = [
      // HAN -> SGN direct
      { num: 'MIX001', from: 'HAN', to: 'SGN', airline: 'VN', hour: 8, minute: 0 },
      { num: 'MIX002', from: 'HAN', to: 'SGN', airline: 'VJ', hour: 10, minute: 30 },
      { num: 'MIX003', from: 'HAN', to: 'SGN', airline: 'QH', hour: 14, minute: 0 },
      
      // SGN -> HAN direct
      { num: 'MIX004', from: 'SGN', to: 'HAN', airline: 'VN', hour: 9, minute: 0 },
      { num: 'MIX005', from: 'SGN', to: 'HAN', airline: 'VJ', hour: 11, minute: 30 },
      { num: 'MIX006', from: 'SGN', to: 'HAN', airline: 'QH', hour: 16, minute: 0 },
      
      // HAN -> DAD (cho 1-stop)
      { num: 'MIX007', from: 'HAN', to: 'DAD', airline: 'VN', hour: 7, minute: 0 },
      { num: 'MIX008', from: 'HAN', to: 'DAD', airline: 'VJ', hour: 13, minute: 0 },
      
      // DAD -> SGN (cho 1-stop)
      { num: 'MIX009', from: 'DAD', to: 'SGN', airline: 'VN', hour: 9, minute: 30 },
      { num: 'MIX010', from: 'DAD', to: 'SGN', airline: 'QH', hour: 15, minute: 30 },
      
      // SGN -> DAD (cho return 1-stop)
      { num: 'MIX011', from: 'SGN', to: 'DAD', airline: 'VJ', hour: 8, minute: 0 },
      { num: 'MIX012', from: 'SGN', to: 'DAD', airline: 'VN', hour: 12, minute: 0 },
      
      // DAD -> HAN (cho return 1-stop)
      { num: 'MIX013', from: 'DAD', to: 'HAN', airline: 'QH', hour: 10, minute: 30 },
      { num: 'MIX014', from: 'DAD', to: 'HAN', airline: 'VJ', hour: 14, minute: 30 },
    ];

    for (const f of flightData) {
      const depTime = new Date('2026-06-10');
      depTime.setHours(f.hour, f.minute, 0, 0);
      
      const arrTime = new Date(depTime.getTime() + 2 * 60 * 60 * 1000);

      // Xóa cũ
      await client.query(`DELETE FROM flight_seat_assignments WHERE flight_id IN (SELECT id FROM flights WHERE flight_number = $1)`, [f.num]);
      await client.query(`DELETE FROM flight_seats WHERE flight_id IN (SELECT id FROM flights WHERE flight_number = $1)`, [f.num]);
      await client.query(`DELETE FROM flights WHERE flight_number = $1`, [f.num]);

      // Tạo flight
      const result = await client.query(`
        INSERT INTO flights (
          flight_number, airline_id, 
          departure_airport_id, arrival_airport_id,
          departure_time, arrival_time,
          duration_minutes, status, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, 120, 'scheduled', true)
        RETURNING id
      `, [f.num, airlineMap[f.airline], airportMap[f.from], airportMap[f.to], depTime, arrTime]);

      const flightId = result.rows[0].id;

      // Tạo seats
      await client.query(`
        INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price, baggage_included_kg, carry_on_kg, extra_baggage_price)
        VALUES ($1, 'economy', 150, 150, 1500000, 23, 7, 60000),
               ($1, 'business', 30, 30, 3500000, 32, 10, 80000)
      `, [flightId]);

      console.log(`✓ ${f.num}: ${f.from} -> ${f.to} (${f.airline})`);
    }

    // Tạo flights return ngày 2026-06-15
    const returnData = [
      { num: 'MIX015', from: 'SGN', to: 'HAN', airline: 'VN', hour: 8, minute: 0 },
      { num: 'MIX016', from: 'SGN', to: 'HAN', airline: 'VJ', hour: 11, minute: 0 },
      { num: 'MIX017', from: 'SGN', to: 'DAD', airline: 'VN', hour: 7, minute: 0 },
      { num: 'MIX018', from: 'DAD', to: 'HAN', airline: 'QH', hour: 9, minute: 30 },
    ];

    for (const f of returnData) {
      const depTime = new Date('2026-06-15');
      depTime.setHours(f.hour, f.minute, 0, 0);
      
      const arrTime = new Date(depTime.getTime() + 2 * 60 * 60 * 1000);

      await client.query(`DELETE FROM flight_seat_assignments WHERE flight_id IN (SELECT id FROM flights WHERE flight_number = $1)`, [f.num]);
      await client.query(`DELETE FROM flight_seats WHERE flight_id IN (SELECT id FROM flights WHERE flight_number = $1)`, [f.num]);
      await client.query(`DELETE FROM flights WHERE flight_number = $1`, [f.num]);

      const result = await client.query(`
        INSERT INTO flights (
          flight_number, airline_id, 
          departure_airport_id, arrival_airport_id,
          departure_time, arrival_time,
          duration_minutes, status, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, 120, 'scheduled', true)
        RETURNING id
      `, [f.num, airlineMap[f.airline], airportMap[f.from], airportMap[f.to], depTime, arrTime]);

      await client.query(`
        INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price, baggage_included_kg, carry_on_kg, extra_baggage_price)
        VALUES ($1, 'economy', 150, 150, 1500000, 23, 7, 60000)
      `, [result.rows[0].id]);

      console.log(`✓ ${f.num}: ${f.from} -> ${f.to} (${f.airline}) [return]`);
    }

    console.log('\n✅ Seed hoan tat!');
    await client.release();
    await pool.end();

  } catch (err) {
    console.error('❌ Lỗi:', err.message);
    await client.release();
    await pool.end();
    throw err;
  }
};

seed().then(() => process.exit(0)).catch(() => process.exit(1));
