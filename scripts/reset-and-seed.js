/**
 * Reset Database and Seed Test Data
 * 
 * Chạy: npm run db:reset
 * 
 * Thứ tự:
 * 1. Reset migrations (chạy lại từ đầu)
 * 2. Seed flights (SQL)
 * 3. Seed bookings/payments/refunds (Node.js)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const log = (msg, type = 'info') => {
  const symbols = { info: '📋', success: '✅', error: '❌', warning: '⚠️' };
  console.log(`${symbols[type] || '📋'} ${msg}`);
};

const runCommand = (cmd, description) => {
  log(description);
  try {
    execSync(cmd, { stdio: 'inherit' });
    return true;
  } catch (err) {
    log(`Lỗi: ${description}`, 'error');
    return false;
  }
};

async function main() {
  console.log('\n========================================');
  console.log('   DATABASE RESET & SEED');
  console.log('========================================\n');

  // 1. Kiểm tra database config
  const dbConfigPath = path.join(__dirname, '../src/config/db.js');
  if (!fs.existsSync(dbConfigPath)) {
    log('Không tìm thấy db config!', 'error');
    process.exit(1);
  }

  // 2. Chạy SQL seed flights
  const flightsSqlPath = path.join(__dirname, '../sql-scripts/seed-flights.sql');
  if (fs.existsSync(flightsSqlPath)) {
    log('Đang tạo flights...', 'info');
    log('⚠️  VUI LÒNG CHẠY THỦ CÔNG TRONG pgAdmin/DBeaver:', 'warning');
    log(`   File: ${flightsSqlPath}`, 'warning');
    log('', 'warning');
  }

  // 3. Chạy Node.js seeder
  const seederPath = path.join(__dirname, '../src/seeders/test-data.seeder.js');
  if (fs.existsSync(seederPath)) {
    log('Đang chạy seeder (bookings, payments, refunds)...', 'info');
    if (!runCommand(`node "${seederPath}"`, 'Node.js Seeder')) {
      log('Seeder thất bại!', 'error');
      process.exit(1);
    }
  }

  console.log('\n========================================');
  console.log('   HOÀN TẤT!');
  console.log('========================================\n');

  log('Tiếp theo:', 'info');
  log('1. Import Postman collection: refund-api-testing.postman_collection.json', 'info');
  log('2. Login với: user@test.com hoặc admin@test.com / password123', 'info');
  log('3. Test API!', 'info');
  console.log('');
}

main().catch(err => {
  log(`Lỗi: ${err.message}`, 'error');
  process.exit(1);
});
