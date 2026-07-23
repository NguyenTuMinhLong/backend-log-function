require("dotenv").config();
const bcrypt = require("bcrypt");
const pool = require("../src/config/db");

async function seedAdmin() {
  const email = "admin@gmail.com";
  const password = "Meomeomeo1990#";   // password mới
  const fullName = "System Admin";

  try {
    console.log("DATABASE_URL loaded:", !!process.env.DATABASE_URL);

    const existing = await pool.query(
      `SELECT id, email, role FROM users WHERE email = $1`,
      [email]
    );

    if (existing.rows.length > 0) {
      const user = existing.rows[0];

      // === UPDATE PASSWORD + các trường khác ===
      const passwordHash = await bcrypt.hash(password, 10);

      const updated = await pool.query(
        `
        UPDATE users
        SET
          password_hash = $1,
          role = 'admin',
          status = 'active',
          email_verified = true,
          updated_at = NOW()
        WHERE email = $2
        RETURNING id, email, role, status
        `,
        [passwordHash, email]
      );

      console.log("Đã cập nhật password admin mới thành công:", updated.rows[0]);
      console.log("email: admin@gmail.com");
      console.log("password mới: Meomeomeo1990#");
      return;
    }

    // Phần tạo mới (nếu chưa có)
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
    console.log("password: Meomeomeo1990#");
  } catch (error) {
    console.error("Seed admin thất bại:");
    console.error(error);
  } finally {
    await pool.end();
  }
}

seedAdmin();