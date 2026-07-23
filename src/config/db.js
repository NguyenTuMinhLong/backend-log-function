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

const baseConnectionString = process.env.DATABASE_URL || "";
const connectionString = baseConnectionString.includes(":5432")
  ? baseConnectionString.replace(":5432", ":6543")
  : baseConnectionString;
const finalConnectionString = connectionString.includes("?")
  ? `${connectionString}&pgbouncer=true`
  : `${connectionString}?pgbouncer=true`;

const pool = new Pool({
  connectionString: finalConnectionString,
  ssl: {
    rejectUnauthorized: false,         // giữ nguyên fix self-signed cert
  },
  family: 4,                           // giữ nguyên IPv4
  max: 10,                             // giảm số connection tối đa (an toàn hơn)
  idleTimeoutMillis: 30000,            // tự động đóng connection idle
  connectionTimeoutMillis: 10000,      // Render/Supabase dễ timeout nếu quá thấp
});

module.exports = pool;

// Tối ưu lại