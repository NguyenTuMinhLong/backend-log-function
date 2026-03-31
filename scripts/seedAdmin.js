require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../src/config/db");

async function seedAdmin() {
  const email = "admin@gmail.com";
  const password = "123456";
  const fullName = "System Admin";

  try {
    console.log("DATABASE_URL loaded:", !!process.env.DATABASE_URL);

    const existing = await pool.query(
      `SELECT id, email, role FROM users WHERE email = $1`,
      [email]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];

      if (user.role !== "admin") {
        const updated = await pool.query(
          `
          UPDATE users
          SET
            role = 'admin',
            status = 'active',
            email_verified = true,
            updated_at = NOW()
          WHERE email = $1
          RETURNING id, email, role, status
          `,
          [email]
        );

        console.log("Đã nâng quyền thành admin:", updated.rows[0]);
      } else {
        console.log("Tài khoản admin đã tồn tại:", user);
      }

      return;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const inserted = await pool.query(
      `
      INSERT INTO users (
        full_name,
        email,
        password_hash,
        role,
        status,
        email_verified,
        phone_verified,
        failed_login_attempts,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, 'admin', 'active', true, false, 0, NOW(), NOW())
      RETURNING id, full_name, email, role, status
      `,
      [fullName, email, passwordHash]
    );

    console.log("Tạo tài khoản admin thành công:", inserted.rows[0]);
    console.log("email: admin@gmail.com");
    console.log("password: 123456");
  } catch (error) {
    console.error("Seed admin thất bại:");
    console.error("message:", error.message);
    console.error("code:", error.code);
    console.error("detail:", error.detail);
    console.error("hint:", error.hint);
    console.error(error);
  } finally {
    await pool.end();
  }
}

seedAdmin();