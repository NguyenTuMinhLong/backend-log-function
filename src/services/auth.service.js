const { sendOTPEmail } = require("../utils/mailer");
const { generateOTP } = require("../utils/otp");
const pool = require("../config/db");
const { hashPassword, comparePassword } = require("../utils/password");

const registerUser = async (data) => {
  const { full_name, email, phone, password } = data;

  const existing = await pool.query(
    "SELECT id FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (existing.rows.length > 0) {
    throw new Error("Email already exists");
  }

  const passwordHash = await hashPassword(password);

  const userResult = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email`,
    [full_name, email, phone, passwordHash]
  );

  const user = userResult.rows[0];
  const otp = generateOTP();

  await pool.query(
    `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
     VALUES ($1, $2, 'register_verify', 'email', NOW() + INTERVAL '5 minutes')`,
    [user.id, otp]
  );

  await sendOTPEmail(user.email, otp);

  return {
    user,
    otp
  };
};

const loginUser = async (data) => {
  const { email, password } = data;

  const result = await pool.query(
    "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error("Invalid credentials");
  }

  const user = result.rows[0];
  const match = await comparePassword(password, user.password_hash);

  if (!match) {
    throw new Error("Invalid credentials");
  }

  return user;
};

const verifyRegisterOTP = async (email, otp) => {
  const userResult = await pool.query(
    "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = userResult.rows[0];

  const otpResult = await pool.query(
    `SELECT * FROM user_otps
     WHERE user_id = $1
       AND otp_code = $2
       AND otp_type = 'register_verify'
       AND is_used = false
       AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id, otp]
  );

  if (otpResult.rows.length === 0) {
    throw new Error("Invalid or expired OTP");
  }

  const otpRow = otpResult.rows[0];

  await pool.query(
    `UPDATE user_otps
     SET is_used = true, used_at = NOW()
     WHERE id = $1`,
    [otpRow.id]
  );

  await pool.query(
    `UPDATE users
     SET email_verified = true
     WHERE id = $1`,
    [user.id]
  );

  return true;
};

const forgotPassword = async (email) => {

  const userResult = await pool.query(
    "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new Error("Email not found");
  }

  const user = userResult.rows[0];

  const otp = generateOTP();

  await pool.query(
    `INSERT INTO user_otps (user_id,otp_code,otp_type,channel,expires_at)
     VALUES ($1,$2,'reset_password','email',NOW() + INTERVAL '5 minutes')`,
    [user.id, otp]
  );

  await sendOTPEmail(user.email, otp);

  return { otp };
};

const verifyResetOTP = async (email, otp) => {

  const userResult = await pool.query(
    "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = userResult.rows[0];

  const otpResult = await pool.query(
    `SELECT * FROM user_otps
     WHERE user_id=$1
     AND otp_code=$2
     AND otp_type='reset_password'
     AND is_used=false
     AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id, otp]
  );

  if (otpResult.rows.length === 0) {
    throw new Error("Invalid or expired OTP");
  }

  const otpRow = otpResult.rows[0];

  await pool.query(
    `UPDATE user_otps SET is_used=true, used_at=NOW() WHERE id=$1`,
    [otpRow.id]
  );

  return true;
};
const resetPassword = async (email, newPassword) => {

  const userResult = await pool.query(
    "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = userResult.rows[0];

  const passwordHash = await hashPassword(newPassword);

  await pool.query(
    `UPDATE users SET password_hash=$1 WHERE id=$2`,
    [passwordHash, user.id]
  );

  return true;
};

module.exports = {
  registerUser,
  loginUser,
  verifyRegisterOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword
};