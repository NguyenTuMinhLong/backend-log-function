// const { Pool } = require("pg");

// const pool = new Pool({
//   host: process.env.DB_HOST,
//   port: process.env.DB_PORT,
//   database: process.env.DB_NAME,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD,
// });

// module.exports = pool;

const { Pool } = require("pg");

const connectionString = process.env.DATABASE_URL
  .replace(':5432', ':6543')           // chuyển sang Transaction mode
  + '?pgbouncer=true';                 // bắt buộc với Supabase

const pool = new Pool({
  connectionString,
  ssl: {
    rejectUnauthorized: false,         // giữ nguyên fix self-signed cert
  },
  family: 4,                           // giữ nguyên IPv4
  max: 10,                             // giảm số connection tối đa (an toàn hơn)
  idleTimeoutMillis: 30000,            // tự động đóng connection idle
  connectionTimeoutMillis: 2000,       // timeout nhanh hơn
});

module.exports = pool;