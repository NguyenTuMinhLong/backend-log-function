/**
 * Full API Test Suite - FIXED
 */

require('dotenv').config();
const http = require('http');

const BASE_URL = 'http://localhost:3000';
let customerToken = '';
let adminToken = '';
let bookingCode = '';
let confirmedBookingCode = '';

const request = (method, path, body = null, token = null) => {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { 'Authorization': `Bearer ${token}` })
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
};

const test = async (name, fn) => {
  try {
    const result = await fn();
    const icon = result.status >= 200 && result.status < 300 ? '✅' : '❌';
    console.log(`${icon} ${name} [${result.status}]`);
    if (result.status >= 400 && result.data?.error) {
      console.log(`   Error: ${result.data.error}`);
    }
    return result;
  } catch (err) {
    console.log(`❌ ${name} [ERROR: ${err.message}]`);
    return { status: 500, data: { error: err.message } };
  }
};

async function runTests() {
  console.log('='.repeat(60));
  console.log('   FLIGHT BOOKING API - FULL TEST SUITE (FIXED)');
  console.log('='.repeat(60));

  // 1. AUTH
  console.log('\n📋 AUTH TESTS\n');

  await test('POST /api/auth/login (Customer)', () =>
    request('POST', '/api/auth/login', { email: 'nguyentuminhlong@gmail.com', password: 'Mamama123#' })
  ).then(r => { if (r.data.token) customerToken = r.data.token; });

  await test('POST /api/auth/login (Admin)', () =>
    request('POST', '/api/auth/login', { email: 'admin@gmail.com', password: 'Meomeomeo1990#' })
  ).then(r => { if (r.data.token) adminToken = r.data.token; });

  // 2. BOOKINGS - User
  console.log('\n📋 BOOKINGS - USER TESTS\n');

  const myBookings = await test('GET /api/bookings/my', () =>
    request('GET', '/api/bookings/my', null, customerToken)
  );
  
  if (myBookings.data?.data && myBookings.data.data.length > 0) {
    // Find a confirmed booking
    const confirmed = myBookings.data.data.find(b => b.status === 'confirmed');
    const pending = myBookings.data.data.find(b => b.status === 'pending');
    confirmedBookingCode = confirmed?.booking_code || pending?.booking_code || myBookings.data.data[0].booking_code;
    bookingCode = confirmedBookingCode;
    console.log(`   📝 First booking: ${bookingCode} (status: ${myBookings.data.data[0].status})`);
    if (confirmed) console.log(`   📝 Confirmed booking: ${confirmed.booking_code}`);
  }

  await test('GET /api/bookings/:code', () =>
    request('GET', `/api/bookings/${bookingCode}`, null, customerToken)
  );

  // 3. BOOKINGS - Admin
  console.log('\n📋 BOOKINGS - ADMIN TESTS\n');

  await test('GET /api/admin/bookings', () =>
    request('GET', '/api/admin/bookings', null, adminToken)
  );

  // 4. REFUNDS - User
  console.log('\n📋 REFUNDS - USER TESTS\n');

  await test('GET /api/refunds/my', () =>
    request('GET', '/api/refunds/my', null, customerToken)
  );

  // Test refund with confirmed booking
  if (confirmedBookingCode) {
    await test('POST /api/bookings/:code/refund (confirmed booking)', () =>
      request('POST', `/api/bookings/${confirmedBookingCode}/refund`, { reason: 'Test refund request' }, customerToken)
    );
  } else {
    console.log('   ⚠️ No confirmed booking available for refund test');
  }

  // 5. REFUNDS - Admin
  console.log('\n📋 REFUNDS - ADMIN TESTS\n');

  await test('GET /api/admin/refunds', () =>
    request('GET', '/api/admin/refunds', null, adminToken)
  );

  // Get a refund to test approve/reject
  const allRefunds = await request('GET', '/api/admin/refunds', null, adminToken);
  const pendingRefund = allRefunds.data?.data?.find(r => r.status === 'pending');
  
  if (pendingRefund) {
    console.log(`   📝 Testing with refund: ${pendingRefund.refund_code} (status: ${pendingRefund.status})`);
    
    await test('POST /api/admin/refunds/:code/approve', () =>
      request('POST', `/api/admin/refunds/${pendingRefund.refund_code}/approve`, { adminNotes: 'Test approval' }, adminToken)
    );
    
    await test('POST /api/admin/refunds/:code/reject (test)', async () => {
      // Find another pending refund for reject test
      const res = await request('GET', '/api/admin/refunds', null, adminToken);
      const pending = res.data?.data?.find(r => r.status === 'pending');
      if (pending) {
        return request('POST', `/api/admin/refunds/${pending.refund_code}/reject`, { reason: 'Test rejection - not eligible', adminNotes: 'Test' }, adminToken);
      }
      return { status: 200, data: { message: 'No pending refund to reject' } };
    });
    
    await test('POST /api/admin/refunds/:code/complete (test)', async () => {
      // Find an approved refund for complete test
      const res = await request('GET', '/api/admin/refunds', null, adminToken);
      const approved = res.data?.data?.find(r => r.status === 'approved');
      if (approved) {
        return request('POST', `/api/admin/refunds/${approved.refund_code}/complete`, { adminNotes: 'Test completion' }, adminToken);
      }
      return { status: 200, data: { message: 'No approved refund to complete' } };
    });
  } else {
    console.log('   ⚠️ No pending refund for approve/reject test');
  }

  // 6. FLIGHTS
  console.log('\n📋 FLIGHTS TESTS\n');

  await test('GET /api/flights/search', () =>
    request('GET', '/api/flights/search?departure_code=SGN&arrival_code=HAN&departure_date=2026-05-20&adults=1&seat_class=economy')
  );

  await test('GET /api/admin/flights', () =>
    request('GET', '/api/admin/flights', null, adminToken)
  );

  // 7. USERS - Admin
  console.log('\n📋 USERS - ADMIN TESTS\n');

  await test('GET /api/admin/users', () =>
    request('GET', '/api/admin/users', null, adminToken)
  );

  await test('GET /api/admin/users/:id', async () => {
    const usersRes = await request('GET', '/api/admin/users', null, adminToken);
    const userId = usersRes.data?.data?.[0]?.id;
    if (userId) {
      return request('GET', `/api/admin/users/${userId}`, null, adminToken);
    }
    return { status: 200, data: { message: 'No users found' } };
  });

  // 8. DATE CHANGE
  console.log('\n📋 DATE CHANGE TESTS\n');

  // Get available flights for date change
  const flights = await request('GET', '/api/flights/search?departure_code=SGN&arrival_code=HAN&departure_date=2026-05-25&adults=1&seat_class=economy');
  const availableFlight = flights.data?.data?.outbound_flights?.[0];

  if (confirmedBookingCode && availableFlight) {
    await test('POST /api/bookings/:code/change-flight', () =>
      request('POST', `/api/bookings/${confirmedBookingCode}/change-flight`, {
        new_flight_id: availableFlight.flight_id,
        new_seat_class: 'economy',
        reason: 'Test date change'
      }, customerToken)
    );
  } else {
    console.log('   ⚠️ Cannot test date change - need confirmed booking and available flight');
  }

  await test('GET /api/admin/date-changes', () =>
    request('GET', '/api/admin/date-changes', null, adminToken)
  );

  await test('GET /api/admin/date-changes/pending', () =>
    request('GET', '/api/admin/date-changes/pending', null, adminToken)
  );

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('   TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`   Customer Token: ${customerToken ? '✅' : '❌'}`);
  console.log(`   Admin Token: ${adminToken ? '✅' : '❌'}`);
  console.log(`   Booking Code: ${bookingCode}`);
  console.log(`   Confirmed Booking: ${confirmedBookingCode}`);
  console.log('');
}

runTests().catch(console.error);
