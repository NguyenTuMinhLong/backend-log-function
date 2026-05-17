/**
 * Seed Test Data lên Supabase
 * Chạy: npm run db:seed
 */

require('dotenv').config();
const { Pool } = require('pg');
const bcrypt = require('bcrypt');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

async function seed() {
  console.log('=== SEEDING SUPABASE ===\n');
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ============================================
    // 1. USERS
    // ============================================
    console.log('1. Tạo Users...');
    
    // Customer: nguyentuminhlong@gmail.com
    const customerPassword = await bcrypt.hash('Mamama123#', 10);
    
    // Admin: admin@gmail.com
    const adminPassword = await bcrypt.hash('Meomeomeo1990#', 10);

    await client.query(`DELETE FROM users WHERE email IN ('nguyentuminhlong@gmail.com', 'admin@gmail.com')`);
    await client.query(`DELETE FROM users WHERE phone IN ('0901234567', '0901234568')`);

    const userResult = await client.query(`
      INSERT INTO users (email, password_hash, full_name, phone, role, status, email_verified)
      VALUES 
        ('nguyentuminhlong@gmail.com', $1, 'Nguyen Tuan Minh Long', '0901234567', 'customer', 'active', true),
        ('admin@gmail.com', $2, 'Admin', '0901234568', 'admin', 'active', true)
      RETURNING id, email, role
    `, [customerPassword, adminPassword]);

    const customerUser = userResult.rows.find(r => r.role === 'customer');
    const adminUser = userResult.rows.find(r => r.role === 'admin');
    console.log(`   ✓ Customer: nguyentuminhlong@gmail.com (ID: ${customerUser.id})`);
    console.log(`   ✓ Admin: admin@gmail.com (ID: ${adminUser.id})\n`);

    // ============================================
    // 2. AIRPORTS
    // ============================================
    console.log('2. Tạo Airports...');
    await client.query(`
      INSERT INTO airports (code, name, city, country, timezone, is_active)
      VALUES 
        ('SGN', 'Tan Son Nhat', 'Ho Chi Minh City', 'Vietnam', 'Asia/Ho_Chi_Minh', true),
        ('HAN', 'Noi Bai', 'Hanoi', 'Vietnam', 'Asia/Ho_Chi_Minh', true),
        ('DAD', 'Da Nang', 'Da Nang', 'Vietnam', 'Asia/Ho_Chi_Minh', true)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    `);

    const airports = await client.query(`SELECT id, code FROM airports WHERE code IN ('SGN', 'HAN', 'DAD')`);
    const airportMap = {};
    airports.rows.forEach(r => airportMap[r.code] = r.id);
    console.log(`   ✓ SGN(ID:${airportMap.SGN}), HAN(ID:${airportMap.HAN}), DAD(ID:${airportMap.DAD})\n`);

    // ============================================
    // 3. AIRLINES
    // ============================================
    console.log('3. Tạo Airlines...');
    await client.query(`
      INSERT INTO airlines (code, name, is_active)
      VALUES 
        ('VN', 'Vietnam Airlines', true),
        ('VJ', 'VietJet Air', true),
        ('QH', 'Q Air', true)
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    `);

    const airlines = await client.query(`SELECT id, code FROM airlines WHERE code IN ('VN', 'VJ', 'QH')`);
    const airlineMap = {};
    airlines.rows.forEach(r => airlineMap[r.code] = r.id);
    console.log(`   ✓ VN(ID:${airlineMap.VN}), VJ(ID:${airlineMap.VJ}), QH(ID:${airlineMap.QH})\n`);

    // ============================================
    // 4. FLIGHTS
    // ============================================
    console.log('4. Tạo Flights...');
    
    // Xóa bookings liên quan trước
    await client.query(`DELETE FROM refunds WHERE booking_id IN (SELECT id FROM bookings WHERE outbound_flight_id IN (SELECT id FROM flights WHERE flight_number LIKE 'TEST%' OR flight_number LIKE 'DAD%'))`);
    await client.query(`DELETE FROM payments WHERE booking_id IN (SELECT id FROM bookings WHERE outbound_flight_id IN (SELECT id FROM flights WHERE flight_number LIKE 'TEST%' OR flight_number LIKE 'DAD%'))`);
    await client.query(`DELETE FROM passengers WHERE booking_id IN (SELECT id FROM bookings WHERE outbound_flight_id IN (SELECT id FROM flights WHERE flight_number LIKE 'TEST%' OR flight_number LIKE 'DAD%'))`);
    await client.query(`DELETE FROM bookings WHERE outbound_flight_id IN (SELECT id FROM flights WHERE flight_number LIKE 'TEST%' OR flight_number LIKE 'DAD%')`);
    await client.query(`DELETE FROM flight_seats WHERE flight_id IN (SELECT id FROM flights WHERE flight_number LIKE 'TEST%' OR flight_number LIKE 'DAD%')`);
    await client.query(`DELETE FROM flights WHERE flight_number LIKE 'TEST%' OR flight_number LIKE 'DAD%'`);

    const flightIds = {};

    for (let i = 1; i <= 10; i++) {
      const origin = i % 2 === 1 ? 'SGN' : 'HAN';
      const dest = i % 2 === 1 ? 'HAN' : 'SGN';
      const airline = ['VN', 'VJ', 'QH'][i % 3];
      const flightNum = 'TEST' + String(i).padStart(3, '0');
      
      const departure = new Date();
      departure.setDate(departure.getDate() + 1 + (i * 2));
      departure.setHours(6 + (i % 12));
      const arrival = new Date(departure.getTime() + 2 * 60 * 60 * 1000);
      
      const result = await client.query(`
        INSERT INTO flights (
          flight_number, airline_id, 
          departure_airport_id, arrival_airport_id,
          departure_time, arrival_time,
          duration_minutes, status, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, 120, 'scheduled', true)
        RETURNING id
      `, [flightNum, airlineMap[airline], airportMap[origin], airportMap[dest], departure, arrival]);

      flightIds[flightNum] = result.rows[0].id;

      await client.query(`
        INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price, baggage_included_kg, carry_on_kg, extra_baggage_price)
        VALUES ($1, 'economy', 150, 150, 1500000, 23, 7, 60000),
               ($1, 'business', 30, 30, 3500000, 32, 10, 80000),
               ($1, 'first', 10, 10, 6000000, 46, 14, 100000)
      `, [flightIds[flightNum]]);

      console.log(`   ✓ ${flightNum}: ${origin}→${dest}`);
    }

    for (let i = 1; i <= 5; i++) {
      const origin = i % 2 === 1 ? 'SGN' : 'DAD';
      const dest = i % 2 === 1 ? 'DAD' : 'SGN';
      const airline = ['VN', 'VJ'][i % 2];
      const flightNum = 'DAD' + String(i).padStart(3, '0');
      
      const departure = new Date();
      departure.setDate(departure.getDate() + 2 + (i * 3));
      departure.setHours(8 + (i % 8));
      const arrival = new Date(departure.getTime() + 75 * 60 * 1000);
      
      const result = await client.query(`
        INSERT INTO flights (
          flight_number, airline_id, 
          departure_airport_id, arrival_airport_id,
          departure_time, arrival_time,
          duration_minutes, status, is_active
        ) VALUES ($1, $2, $3, $4, $5, $6, 75, 'scheduled', true)
        RETURNING id
      `, [flightNum, airlineMap[airline], airportMap[origin], airportMap[dest], departure, arrival]);

      flightIds[flightNum] = result.rows[0].id;

      await client.query(`
        INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price, baggage_included_kg, carry_on_kg, extra_baggage_price)
        VALUES ($1, 'economy', 120, 120, 900000, 20, 7, 50000),
               ($1, 'business', 20, 20, 2200000, 30, 10, 70000)
      `, [flightIds[flightNum]]);

      console.log(`   ✓ ${flightNum}: ${origin}→${dest}`);
    }

    console.log('');

    // ============================================
    // 5. BOOKINGS + PAYMENTS
    // ============================================
    console.log('5. Tạo Bookings...');

    const bookings = [];

    // B1: One-way, 1 adult
    const b1 = await createBooking(client, {
      userId: customerUser.id,
      flightId: flightIds.TEST001,
      seatClass: 'economy',
      tripType: 'one_way',
      adults: 1, contactName: 'Nguyen Tuan Minh Long', contactEmail: 'nguyentuminhlong@gmail.com'
    });
    bookings.push(b1);

    // B2: One-way, 2 adults + 1 child
    const b2 = await createBooking(client, {
      userId: customerUser.id,
      flightId: flightIds.TEST002,
      seatClass: 'economy',
      tripType: 'one_way',
      adults: 2, children: 1, contactName: 'Family Long', contactEmail: 'nguyentuminhlong@gmail.com'
    });
    bookings.push(b2);

    // B3: Round-trip
    const b3 = await createRoundTripBooking(client, {
      userId: customerUser.id,
      outboundFlightId: flightIds.TEST003,
      returnFlightId: flightIds.TEST004,
      seatClass: 'economy',
      adults: 1, contactName: 'Nguyen Long', contactEmail: 'nguyentuminhlong@gmail.com'
    });
    bookings.push(b3);

    // B4: Business class
    const b4 = await createBooking(client, {
      userId: customerUser.id,
      flightId: flightIds.TEST005,
      seatClass: 'business',
      tripType: 'one_way',
      adults: 1, contactName: 'VIP Long', contactEmail: 'nguyentuminhlong@gmail.com'
    });
    bookings.push(b4);

    // B5: Guest (no user)
    const b5 = await createBooking(client, {
      userId: null,
      flightId: flightIds.TEST006,
      seatClass: 'economy',
      tripType: 'one_way',
      adults: 1, contactName: 'Guest User', contactEmail: 'guest@test.com'
    });
    bookings.push(b5);

    console.log(`   ✓ Đã tạo ${bookings.length} bookings\n`);

    // ============================================
    // 6. REFUNDS
    // ============================================
    console.log('6. Tạo Refunds...');

    const r1 = await createRefund(client, {
      bookingId: bookings[0].id,
      amount: 1500000,
      status: 'pending',
      reason: 'Thay đổi kế hoạch'
    });
    console.log(`   ✓ PENDING: ${r1.code}`);

    const r2 = await createRefund(client, {
      bookingId: bookings[1].id,
      amount: 2550000,
      status: 'approved',
      reason: 'Hủy chuyến',
      processedBy: adminUser.id
    });
    console.log(`   ✓ APPROVED: ${r2.code}`);

    const r3 = await createRefund(client, {
      bookingId: bookings[2].id,
      amount: 3000000,
      status: 'completed',
      reason: 'Khách yêu cầu hủy',
      processedBy: adminUser.id
    });
    console.log(`   ✓ COMPLETED: ${r3.code}`);

    await client.query('COMMIT');

    // ============================================
    // SUMMARY
    // ============================================
    console.log('\n========================================');
    console.log('   ✅ SEED HOÀN TẤT!');
    console.log('========================================\n');
    console.log('📊 TỔNG KẾT:');
    console.log('   • Users: 2');
    console.log('   • Flights: 15 (TEST001-010, DAD001-005)');
    console.log(`   • Bookings: ${bookings.length}`);
    console.log('   • Refunds: 3\n');
    console.log('🔐 LOGIN CREDENTIALS:');
    console.log('   Customer: nguyentuminhlong@gmail.com / Mamama123#');
    console.log('   Admin:    admin@gmail.com / Meomeomeo1990#\n');
    console.log('📝 BOOKING CODES:');
    bookings.forEach((b, i) => console.log(`   ${i + 1}. ${b.code}`));
    console.log('');

  } catch (err) {
    console.error('❌ LỖI:', err.message);
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

// ============================================
// HELPERS
// ============================================

async function createBooking(client, data) {
  const { userId, flightId, seatClass, tripType, adults = 1, children = 0, infants = 0, contactName, contactEmail } = data;

  const bookingCode = 'T' + Date.now().toString().slice(-9);
  const heldUntil = new Date(Date.now() + 30 * 60 * 1000);
  const basePrice = seatClass === 'business' ? 3500000 : 1500000;
  const totalPrice = basePrice * adults * (1 + children * 0.75);

  const bookingResult = await client.query(`
    INSERT INTO bookings (
      booking_code, user_id, 
      outbound_flight_id, outbound_seat_class, 
      trip_type, 
      total_adults, total_children, total_infants,
      base_price, total_price,
      contact_name, contact_email, contact_phone,
      held_until, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'confirmed')
    RETURNING id, booking_code
  `, [bookingCode, userId, flightId, seatClass, tripType, adults, children, infants, basePrice, totalPrice, contactName, contactEmail, '0912345678', heldUntil]);

  const booking = bookingResult.rows[0];

  for (let i = 0; i < adults; i++) {
    await client.query(`
      INSERT INTO passengers (booking_id, flight_type, passenger_type, full_name, date_of_birth, gender, nationality)
      VALUES ($1, 'outbound', 'adult', $2, '1990-01-01', 'male', 'VN')
    `, [booking.id, `${contactName} Adult ${i + 1}`]);
  }
  for (let i = 0; i < children; i++) {
    await client.query(`
      INSERT INTO passengers (booking_id, flight_type, passenger_type, full_name, date_of_birth, gender, nationality)
      VALUES ($1, 'outbound', 'child', $2, '2015-01-01', 'female', 'VN')
    `, [booking.id, `${contactName} Child ${i + 1}`]);
  }

  const paymentId = require('crypto').randomUUID();
  const paymentCode = 'P' + Date.now().toString().slice(-9);
  await client.query(`
    INSERT INTO payments (id, booking_id, payment_code, payment_method, amount, discount_amount, final_amount, status, paid_at)
    VALUES ($1, $2, $3, 'BANK_QR', $4, 0, $4, 'SUCCESS', NOW())
  `, [paymentId, booking.id, paymentCode, totalPrice]);

  const paymentResult = await client.query(`SELECT id FROM payments WHERE booking_id = $1`, [booking.id]);

  return { id: booking.id, code: booking.booking_code, paymentId: paymentResult.rows[0]?.id };
}

async function createRoundTripBooking(client, data) {
  const { userId, outboundFlightId, returnFlightId, seatClass, adults = 1, contactName, contactEmail } = data;

  const bookingCode = 'R' + Date.now().toString().slice(-9);
  const heldUntil = new Date(Date.now() + 30 * 60 * 1000);
  const totalPrice = 3000000;

  const bookingResult = await client.query(`
    INSERT INTO bookings (
      booking_code, user_id, 
      outbound_flight_id, outbound_seat_class,
      return_flight_id, return_seat_class,
      trip_type, 
      total_adults, total_children, total_infants,
      base_price, total_price,
      contact_name, contact_email, contact_phone,
      held_until, status
    ) VALUES ($1, $2, $3, $4, $5, $6, 'round_trip', $7, 0, 0, 1500000, $8, $9, $10, $11, $12, 'confirmed')
    RETURNING id, booking_code
  `, [bookingCode, userId, outboundFlightId, seatClass, returnFlightId, seatClass, adults, totalPrice, contactName, contactEmail, '0912345678', heldUntil]);

  const booking = bookingResult.rows[0];

  for (let i = 0; i < adults; i++) {
    await client.query(`
      INSERT INTO passengers (booking_id, flight_type, passenger_type, full_name, date_of_birth, gender, nationality)
      VALUES ($1, 'outbound', 'adult', $2, '1990-01-01', 'male', 'VN'),
             ($1, 'return', 'adult', $2, '1990-01-01', 'male', 'VN')
    `, [booking.id, `${contactName} Adult ${i + 1}`]);
  }

  const paymentId = require('crypto').randomUUID();
  const paymentCode = 'P' + (Date.now() + 1).toString().slice(-9);
  await client.query(`
    INSERT INTO payments (id, booking_id, payment_code, payment_method, amount, discount_amount, final_amount, status, paid_at)
    VALUES ($1, $2, $3, 'MOMO', $4, 0, $4, 'SUCCESS', NOW())
  `, [paymentId, booking.id, paymentCode, totalPrice]);

  const paymentResult = await client.query(`SELECT id FROM payments WHERE booking_id = $1`, [booking.id]);

  return { id: booking.id, code: booking.booking_code, paymentId: paymentResult.rows[0]?.id };
}

async function createRefund(client, data) {
  const { bookingId, amount, status, reason, processedBy } = data;
  const refundCode = 'REF' + Date.now().toString().slice(-8);

  let query, values;

  if (processedBy && status === 'completed') {
    query = `
      INSERT INTO refunds (
        refund_code, booking_id,
        refund_type, refund_amount, admin_fee, net_refund_amount,
        refund_policy_applied, status, reason,
        processed_by, processed_at, completed_at
      ) VALUES ($1, $2, 'full', $3, 0, $3, '{"name":"full_refund","refund_percent":100}', $4, $5, $6, NOW(), NOW())
    `;
    values = [refundCode, bookingId, amount, status, reason, processedBy];
  } else if (processedBy) {
    query = `
      INSERT INTO refunds (
        refund_code, booking_id,
        refund_type, refund_amount, admin_fee, net_refund_amount,
        refund_policy_applied, status, reason,
        processed_by, processed_at
      ) VALUES ($1, $2, 'full', $3, 0, $3, '{"name":"full_refund","refund_percent":100}', $4, $5, $6, NOW())
    `;
    values = [refundCode, bookingId, amount, status, reason, processedBy];
  } else {
    query = `
      INSERT INTO refunds (
        refund_code, booking_id,
        refund_type, refund_amount, admin_fee, net_refund_amount,
        refund_policy_applied, status, reason
      ) VALUES ($1, $2, 'full', $3, 0, $3, '{"name":"full_refund","refund_percent":100}', $4, $5)
    `;
    values = [refundCode, bookingId, amount, status, reason];
  }

  await client.query(query, values);
  await client.query(`UPDATE bookings SET status = 'refund_pending' WHERE id = $1`, [bookingId]);

  return { code: refundCode };
}

// ============================================
// RUN
// ============================================
seed()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
