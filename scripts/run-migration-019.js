// Script chạy migration 019 trực tiếp
require('dotenv').config();
const pool = require('../src/config/db');

const run = async () => {
  try {
    // Tạo bảng booking_legs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS booking_legs (
        id BIGSERIAL PRIMARY KEY,
        booking_id BIGINT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
        flight_id INT NOT NULL REFERENCES flights(id),
        leg_order INT NOT NULL,
        direction VARCHAR(10) NOT NULL,
        seat_class VARCHAR(20) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT chk_leg_direction CHECK (direction IN ('outbound', 'return'))
      )
    `);
    console.log('Table booking_legs created');

    // Tạo index
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_booking_legs_booking_id ON booking_legs (booking_id)
    `);
    console.log('Index created');

    // Đánh dấu migration đã chạy
    await pool.query(`
      INSERT INTO schema_migrations (filename) VALUES ('019_create_booking_legs.sql') ON CONFLICT (filename) DO NOTHING
    `);
    console.log('Migration marked as done');

    console.log('Migration 019 completed!');
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await pool.end();
  }
};

run();
