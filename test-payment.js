/**
 * Payment Gateway Integration Test Script
 * Run: node test-payment.js
 */

require('dotenv').config();
const pool = require('./src/config/db');
const paymentService = require('./src/services/payment.service');

async function testPaymentFlow() {
  console.log('=== Payment Gateway Integration Test ===\n');

  try {
    // Test 1: Check database connection
    console.log('1. Testing database connection...');
    const dbTest = await pool.query('SELECT 1 as test');
    console.log('   ✓ Database connected\n');

    // Test 2: Check payment config
    console.log('2. Testing payment config...');
    const config = require('./src/config/payment.config');
    console.log(`   PayOS enabled: ${config.payos.enabled}`);
    console.log(`   MoMo enabled: ${config.momo.enabled}`);
    console.log(`   PayPal enabled: ${config.paypal.enabled}`);
    console.log(`   BankQR enabled: ${config.bankQr.enabled}`);
    console.log('   ✓ Config loaded\n');

    // Test 3: Get a confirmed booking with payment
    console.log('3. Finding confirmed booking with payment...');
    const bookingResult = await pool.query(`
      SELECT b.id, b.booking_code, b.status, b.total_price,
             p.id as payment_id, p.payment_code, p.status as payment_status, p.gateway_response
      FROM bookings b
      JOIN payments p ON p.booking_id = b.id
      WHERE b.status = 'confirmed' AND p.status = 'SUCCESS'
      LIMIT 1
    `);

    if (bookingResult.rows.length === 0) {
      console.log('   ⚠ No confirmed bookings with successful payment found');
      console.log('   Create a booking and payment to test\n');
    } else {
      const booking = bookingResult.rows[0];
      console.log(`   Found: ${booking.booking_code} (Payment: ${booking.payment_code})`);
      console.log(`   Gateway: ${booking.gateway_response?.provider || 'N/A'}`);
      console.log('   ✓ Booking with payment found\n');
    }

    // Test 4: Test previewPayment
    console.log('4. Testing previewPayment...');
    try {
      const previewResult = await paymentService.previewPayment({ booking_code: 'T123456789' }, null);
      console.log(`   Preview: ${previewResult.booking_code}, Amount: ${previewResult.final_amount}`);
      console.log('   ✓ previewPayment works\n');
    } catch (err) {
      console.log(`   ⚠ previewPayment: ${err.message}\n`);
    }

    // Test 5: Check available payment methods
    console.log('5. Available payment methods:');
    console.log('   - BANK_QR (VietQR with PayOS)');
    console.log('   - MOMO (MoMo QR)');
    console.log('   - PAYPAL (PayPal checkout)');
    console.log('');

    console.log('=== Test Complete ===');
    console.log('\nTo test real payment:');
    console.log('1. Set up PayOS/MoMo/PayPal sandbox credentials in .env');
    console.log('2. Create a booking and initiate payment');
    console.log('3. Use the checkout URLs returned to complete payment');
    console.log('4. Check webhook handlers for payment confirmation');

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

testPaymentFlow();
