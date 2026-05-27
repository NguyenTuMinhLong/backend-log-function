require("dotenv").config();
const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");

const baseUrl = process.env.DATABASE_URL || "";
const connectionString = baseUrl.includes(":5432")
  ? baseUrl.replace(":5432", ":6543")
  : baseUrl;
const finalUrl = connectionString.includes("?")
  ? `${connectionString}&pgbouncer=true`
  : `${connectionString}?pgbouncer=true`;

const pool = new Pool({ connectionString: finalUrl, ssl: { rejectUnauthorized: false }, family: 4 });

const file = process.argv[2] || "src/migrations/014_update_seat_pricing.sql";
const sql = fs.readFileSync(path.resolve(__dirname, file), "utf8");

pool.query(sql)
  .then(() => { console.log("✓ Migration chạy thành công:", file); pool.end(); })
  .catch((err) => { console.error("✗ Lỗi:", err.message); pool.end(); process.exit(1); });
