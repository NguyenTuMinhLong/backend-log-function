const { sendOTPEmail } = require("../utils/mailer");
const { generateOTP } = require("../utils/otp");
const pool = require("../config/db");
const { hashPassword, comparePassword } = require("../utils/password");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require("../utils/jwt");

const revokeAllUserRefreshTokens = async (userId, db = pool) => {
  await db.query(
    `UPDATE refresh_tokens
     SET is_revoked = TRUE,
         revoked_at = NOW()
     WHERE user_id = $1
       AND is_revoked = FALSE`,
    [userId]
  );
};

const issueAuthTokens = async (user, db = pool) => {
  const accessToken = generateAccessToken(user);
  const refreshTokenData = generateRefreshToken(user);

  await db.query(
    `DELETE FROM refresh_tokens
     WHERE user_id = $1
       AND (is_revoked = TRUE OR expires_at < NOW())`,
    [user.id]
  );

  await db.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, hashToken(refreshTokenData.token), refreshTokenData.expiresAt]
  );

  return {
    token: accessToken,
    refresh_token: refreshTokenData.token,
    refresh_token_expires_at: refreshTokenData.expiresAt,
  };
};

const refreshUserSession = async (refreshToken) => {
  if (!refreshToken) {
    throw new Error("refresh_token is required");
  }

  const decoded = verifyRefreshToken(refreshToken);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `SELECT
         rt.id AS refresh_token_id,
         u.*
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token = $1
         AND rt.is_revoked = FALSE
         AND rt.expires_at > NOW()
       LIMIT 1
       FOR UPDATE`,
      [hashToken(refreshToken)]
    );

    if (result.rows.length === 0) {
      throw new Error("Invalid or expired refresh token");
    }

    const user = result.rows[0];

    if (Number(user.id) !== Number(decoded.id)) {
      throw new Error("Refresh token does not match user");
    }

    if (user.status !== "active") {
      throw new Error("Account is inactive or blocked");
    }

    await client.query(
      `UPDATE refresh_tokens
       SET is_revoked = TRUE,
           revoked_at = NOW()
       WHERE id = $1`,
      [user.refresh_token_id]
    );

    const tokens = await issueAuthTokens(user, client);

    await client.query("COMMIT");

    return {
      ...tokens,
      user,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const logoutUserSession = async (userId, refreshToken = null) => {
  if (!userId) {
    throw new Error("userId is required");
  }

  if (!refreshToken) {
    await revokeAllUserRefreshTokens(userId);
    return true;
  }

  await pool.query(
    `UPDATE refresh_tokens
     SET is_revoked = TRUE,
         revoked_at = NOW()
     WHERE user_id = $1
       AND token = $2
       AND is_revoked = FALSE`,
    [userId, hashToken(refreshToken)]
  );

  return true;
};

const registerUser = async (data) => {
  const { full_name, email, phone, password, confirm_password } = data;

  if (!full_name || !email || !password || !confirm_password) {
    throw new Error("Full name, email, password and confirm password are required");
  }

  if (password.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (password !== confirm_password) {
    throw new Error("Password and confirm password do not match");
  }

  const existingEmail = await pool.query(
    "SELECT id, password_hash, auth_provider FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (existingEmail.rows.length > 0) {
    const existing = existingEmail.rows[0];
    // Tài khoản đã tồn tại qua social login (không có password)
    if (!existing.password_hash) {
      throw new Error(
        "This email is already linked to a social account (Google/Facebook). Please sign in with social login, then set a password from your profile if needed."
      );
    }
    throw new Error("Email already exists");
  }

  if (phone) {
    const existingPhone = await pool.query(
      "SELECT id FROM users WHERE phone = $1",
      [phone]
    );

    if (existingPhone.rows.length > 0) {
      throw new Error("Phone already exists");
    }
  }

  const passwordHash = await hashPassword(password);

  const userResult = await pool.query(
    `INSERT INTO users (full_name, email, phone, password_hash)
     VALUES ($1, $2, $3, $4)
     RETURNING id, full_name, email, phone, email_verified`,
    [full_name, email, phone || null, passwordHash]
  );

  const user = userResult.rows[0];
  const otp = generateOTP();

  await pool.query(
    `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
     VALUES ($1, $2, 'register_verify', 'email', NOW() + INTERVAL '5 minutes')`,
    [user.id, otp]
  );

  // 🔥 FIX: không cho mail làm crash API
  try {
    sendOTPEmail(user.email, otp);
  } catch (err) {
    console.log("❌ MAIL FAILED BUT CONTINUE:", err.message);
  }

  return {
    user,
    otp,
  };
};

const loginUser = async (data) => {
  const { email, password } = data;

  if (!email || !password) {
    throw new Error("Email and password are required");
  }

  const result = await pool.query(
    "SELECT * FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (result.rows.length === 0) {
    throw new Error("Invalid credentials");
  }

  const user = result.rows[0];

  if (user.status !== "active") {
    throw new Error("Account is inactive or blocked");
  }

  if (!user.email_verified) {
    throw new Error("Email not verified");
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new Error("Account is temporarily locked. Please try again later");
  }

  // Tài khoản chỉ dùng social login, chưa đặt mật khẩu
  if (!user.password_hash) {
    throw new Error(
      "This account uses Google/Facebook login and has no password set. Please sign in with social login, or use 'Forgot Password' to set a password."
    );
  }

  const match = await comparePassword(password, user.password_hash);

  if (!match) {
    const newFailedAttempts = user.failed_login_attempts + 1;

    if (newFailedAttempts >= 5) {
      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1,
             locked_until = NOW() + INTERVAL '15 minutes',
             updated_at = NOW()
WHERE id = $2`,
        [newFailedAttempts, user.id]
      );

      throw new Error("Too many failed login attempts. Account locked for 15 minutes");
    } else {
      await pool.query(
        `UPDATE users
         SET failed_login_attempts = $1,
             updated_at = NOW()
         WHERE id = $2`,
        [newFailedAttempts, user.id]
      );

      throw new Error(`Invalid credentials. ${5 - newFailedAttempts} attempt(s) remaining`);
    }
  }

  await pool.query(
    `UPDATE users
     SET failed_login_attempts = 0,
         locked_until = NULL,
         last_login_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

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

  try {
    sendOTPEmail(user.email, otp);
  } catch (err) {
    console.log("❌ MAIL FAILED:", err.message);
  }

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

const resetPassword = async (email, otp, newPassword, confirmPassword) => {
  if (!email || !otp || !newPassword || !confirmPassword) {
    throw new Error("All fields are required");
  }

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Password and confirm password do not match");
  }

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
    `UPDATE user_otps
     SET is_used=true, used_at=NOW()
     WHERE id=$1`,
    [otpRow.id]
  );

  const passwordHash = await hashPassword(newPassword);

  await pool.query(
    `UPDATE users
     SET password_hash=$1, updated_at=NOW()
     WHERE id=$2`,
    [passwordHash, user.id]
  );

  await revokeAllUserRefreshTokens(user.id);

  return true;
};

const getMe = async (userId) => {
  const result = await pool.query(
    `SELECT
       id,
       full_name,
       email,
       phone,
       role,
       status,
       email_verified,
       phone_verified,
       auth_provider,
       avatar_url,
       created_at,
       CASE
         WHEN password_hash IS NOT NULL THEN TRUE
         ELSE FALSE
       END AS has_password
     FROM users
     WHERE id = $1`,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error("User not found");
  }

  return result.rows[0];
};

const changePassword = async (userId, oldPassword, newPassword, confirmPassword) => {
  if (!oldPassword || !newPassword || !confirmPassword) {
    throw new Error("All fields are required");
  }

  if (newPassword.length < 8) {
    throw new Error("New password must be at least 8 characters");
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Password and confirm password do not match");
  }

  const result = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = result.rows[0];

  if (!user.password_hash) {
    throw new Error("Account does not have a password yet. Please use set-password first");
  }

  const isMatch = await comparePassword(oldPassword, user.password_hash);

  if (!isMatch) {
    throw new Error("Old password is incorrect");
  }

  if (oldPassword === newPassword) {
    throw new Error("New password must be different from old password");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await pool.query(
    `UPDATE users
     SET password_hash = $1, updated_at = NOW()
     WHERE id = $2`,
    [newPasswordHash, userId]
  );

  await revokeAllUserRefreshTokens(userId);

  return true;
};

const setPassword = async (userId, newPassword, confirmPassword) => {
  if (!newPassword || !confirmPassword) {
    throw new Error("new_password and confirm_password are required");
  }

  if (newPassword.length < 8) {
    throw new Error("Password must be at least 8 characters");
  }

  if (newPassword !== confirmPassword) {
    throw new Error("Password and confirm password do not match");
  }

  const result = await pool.query(
    "SELECT id, password_hash FROM users WHERE id = $1",
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = result.rows[0];

  if (user.password_hash) {
    throw new Error("Password already exists for this account. Please use change-password");
  }

  const newPasswordHash = await hashPassword(newPassword);

  await pool.query(
    `UPDATE users
     SET password_hash = $1, updated_at = NOW()
     WHERE id = $2`,
    [newPasswordHash, userId]
  );

  await revokeAllUserRefreshTokens(userId);

  return true;
};

const resendRegisterOTP = async (email) => {
  if (!email) {
    throw new Error("Email is required");
}

  const userResult = await pool.query(
    "SELECT * FROM users WHERE LOWER(email) = LOWER($1)",
    [email]
  );

  if (userResult.rows.length === 0) {
    throw new Error("User not found");
  }

  const user = userResult.rows[0];

  if (user.email_verified) {
    throw new Error("Email is already verified");
  }

  const otp = generateOTP();

  await pool.query(
    `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
     VALUES ($1, $2, 'register_verify', 'email', NOW() + INTERVAL '5 minutes')`,
    [user.id, otp]
  );

  try {
    sendOTPEmail(user.email, otp);
  } catch (err) {
    console.log("❌ MAIL FAILED:", err.message);
  }

  return {
    email: user.email,
    otp,
  };
};

module.exports = {
  registerUser,
  loginUser,
  verifyRegisterOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  getMe,
  changePassword,
  setPassword,
  issueAuthTokens,
  refreshUserSession,
  logoutUserSession,
  resendRegisterOTP,
};
