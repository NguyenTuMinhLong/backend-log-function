const { sendOTPEmail } = require("../utils/mailer");
const { generateOTP }  = require("../utils/otp");
const pool             = require("../config/db");
const { hashPassword, comparePassword } = require("../utils/password");
const {
  generateAccessToken,
  generateRefreshToken,
  verifyRefreshToken,
  hashToken,
} = require("../utils/jwt");
const QU = require("../queries/user.queries");
const QA = require("../queries/auth.queries");

const revokeAllUserRefreshTokens = async (userId, db = pool) => {
  await db.query(QA.REVOKE_ALL_REFRESH_TOKENS, [userId]);
};

const issueAuthTokens = async (user, db = pool) => {
  const accessToken      = generateAccessToken(user);
  const refreshTokenData = generateRefreshToken(user);

  await db.query(QA.DELETE_EXPIRED_REFRESH_TOKENS, [user.id]);
  await db.query(QA.INSERT_REFRESH_TOKEN, [
    user.id, hashToken(refreshTokenData.token), refreshTokenData.expiresAt,
  ]);

  return {
    token:                    accessToken,
    refresh_token:            refreshTokenData.token,
    refresh_token_expires_at: refreshTokenData.expiresAt,
  };
};

const refreshUserSession = async (refreshToken) => {
  if (!refreshToken) throw new Error("refresh_token is required");

  const decoded = verifyRefreshToken(refreshToken);
  const client  = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(QA.SELECT_REFRESH_TOKEN_WITH_USER, [hashToken(refreshToken)]);

    if (result.rows.length === 0) throw new Error("Invalid or expired refresh token");

    const user = result.rows[0];

    if (Number(user.id) !== Number(decoded.id)) throw new Error("Refresh token does not match user");
    if (user.status !== "active") throw new Error("Account is inactive or blocked");

    await client.query(QA.REVOKE_REFRESH_TOKEN_BY_ID, [user.refresh_token_id]);

    const tokens = await issueAuthTokens(user, client);

    await client.query("COMMIT");
    return { ...tokens, user };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const logoutUserSession = async (userId, refreshToken = null) => {
  if (!userId) throw new Error("userId is required");

  if (!refreshToken) {
    await revokeAllUserRefreshTokens(userId);
    return true;
  }

  await pool.query(QA.REVOKE_REFRESH_TOKEN_BY_USER_AND_TOKEN, [userId, hashToken(refreshToken)]);
  return true;
};

const registerUser = async (data) => {
  const { full_name, email, phone, password, confirm_password } = data;

  if (!full_name || !email || !password || !confirm_password) {
    throw new Error("Full name, email, password and confirm password are required");
  }
  if (password.length < 8) throw new Error("Password must be at least 8 characters");
  if (password !== confirm_password) throw new Error("Password and confirm password do not match");

  const existingEmail = await pool.query(QU.FIND_USER_EMAIL_AUTH, [email]);
  if (existingEmail.rows.length > 0) {
    const existing = existingEmail.rows[0];
    if (!existing.password_hash) {
      throw new Error(
        "This email is already linked to a social account (Google/Facebook). Please sign in with social login, then set a password from your profile if needed."
      );
    }
    throw new Error("Email already exists");
  }

  if (phone) {
    const existingPhone = await pool.query(QU.FIND_USER_BY_PHONE, [phone]);
    if (existingPhone.rows.length > 0) throw new Error("Phone already exists");
  }

  const passwordHash = await hashPassword(password);
  const userResult   = await pool.query(QU.INSERT_USER, [full_name, email, phone || null, passwordHash]);
  const user         = userResult.rows[0];
  const otp          = generateOTP();

  await pool.query(QA.INSERT_REGISTER_OTP, [user.id, otp]);

  try {
    sendOTPEmail(user.email, otp);
  } catch (err) {
    console.log("❌ MAIL FAILED BUT CONTINUE:", err.message);
  }

  return { user, otp };
};

const loginUser = async (data) => {
  const { email, password } = data;
  if (!email || !password) throw new Error("Email and password are required");

  const result = await pool.query(QU.FIND_USER_BY_EMAIL, [email]);
  if (result.rows.length === 0) throw new Error("Invalid credentials");

  const user = result.rows[0];

  if (user.status !== "active")              throw new Error("Account is inactive or blocked");
  if (!user.email_verified)                  throw new Error("Email not verified");
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    throw new Error("Account is temporarily locked. Please try again later");
  }
  if (!user.password_hash) {
    throw new Error(
      "This account uses Google/Facebook login and has no password set. Please sign in with social login, or use 'Forgot Password' to set a password."
    );
  }

  const match = await comparePassword(password, user.password_hash);

  if (!match) {
    const newFailedAttempts = user.failed_login_attempts + 1;

    if (newFailedAttempts >= 5) {
      await pool.query(QU.UPDATE_LOGIN_LOCK, [newFailedAttempts, user.id]);
      throw new Error("Too many failed login attempts. Account locked for 15 minutes");
    } else {
      await pool.query(QU.UPDATE_FAILED_ATTEMPTS, [newFailedAttempts, user.id]);
      throw new Error(`Invalid credentials. ${5 - newFailedAttempts} attempt(s) remaining`);
    }
  }

  await pool.query(QU.RESET_LOGIN_STATE, [user.id]);
  return user;
};

const verifyRegisterOTP = async (email, otp) => {
  const userResult = await pool.query(QU.FIND_USER_BY_EMAIL, [email]);
  if (userResult.rows.length === 0) throw new Error("User not found");

  const user      = userResult.rows[0];
  const otpResult = await pool.query(QA.SELECT_REGISTER_OTP, [user.id, otp]);
  if (otpResult.rows.length === 0) throw new Error("Invalid or expired OTP");

  const otpRow = otpResult.rows[0];
  await pool.query(QA.MARK_OTP_USED, [otpRow.id]);
  await pool.query(QU.VERIFY_USER_EMAIL, [user.id]);
  return true;
};

const forgotPassword = async (email) => {
  const userResult = await pool.query(QU.FIND_USER_BY_EMAIL, [email]);
  if (userResult.rows.length === 0) throw new Error("Email not found");

  const user = userResult.rows[0];
  const otp  = generateOTP();

  await pool.query(QA.INSERT_RESET_PASSWORD_OTP, [user.id, otp]);

  try {
    sendOTPEmail(user.email, otp);
  } catch (err) {
    console.log("❌ MAIL FAILED:", err.message);
  }

  return { otp };
};

const verifyResetOTP = async (email, otp) => {
  const userResult = await pool.query(QU.FIND_USER_BY_EMAIL, [email]);
  if (userResult.rows.length === 0) throw new Error("User not found");

  const user      = userResult.rows[0];
  const otpResult = await pool.query(QA.SELECT_RESET_PASSWORD_OTP, [user.id, otp]);
  if (otpResult.rows.length === 0) throw new Error("Invalid or expired OTP");

  await pool.query(QA.MARK_OTP_USED, [otpResult.rows[0].id]);
  return true;
};

const resetPassword = async (email, otp, newPassword, confirmPassword) => {
  if (!email || !otp || !newPassword || !confirmPassword) throw new Error("All fields are required");
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  if (newPassword !== confirmPassword) throw new Error("Password and confirm password do not match");

  const userResult = await pool.query(QU.FIND_USER_BY_EMAIL, [email]);
  if (userResult.rows.length === 0) throw new Error("User not found");

  const user      = userResult.rows[0];
  const otpResult = await pool.query(QA.SELECT_RESET_PASSWORD_OTP, [user.id, otp]);
  if (otpResult.rows.length === 0) throw new Error("Invalid or expired OTP");

  await pool.query(QA.MARK_OTP_USED, [otpResult.rows[0].id]);

  const passwordHash = await hashPassword(newPassword);
  await pool.query(QU.UPDATE_USER_PASSWORD, [passwordHash, user.id]);
  await revokeAllUserRefreshTokens(user.id);
  return true;
};

const getMe = async (userId) => {
  const result = await pool.query(QU.SELECT_ME, [userId]);
  if (result.rows.length === 0) throw new Error("User not found");
  return result.rows[0];
};

const normalizeProfileText = (value) => {
  if (value === undefined) return undefined;
  const normalized = String(value || "").trim();
  return normalized || null;
};

const updateProfile = async (userId, data = {}) => {
  const fullName    = normalizeProfileText(data.full_name);
  const phone       = normalizeProfileText(data.phone);
  const dateOfBirth = normalizeProfileText(data.date_of_birth);
  const gender      = normalizeProfileText(data.gender);
  const address     = normalizeProfileText(data.address);
  const avatarUrl   = normalizeProfileText(data.avatar_url);

  if (!fullName) throw new Error("Full name is required");
  if (phone && !/^[0-9+\-\s()]{8,20}$/.test(phone)) throw new Error("Phone number is not valid");
  if (dateOfBirth && Number.isNaN(new Date(dateOfBirth).getTime())) throw new Error("Date of birth is not valid");
  if (gender && !["male", "female", "other"].includes(gender)) throw new Error("Gender must be male, female or other");
  if (avatarUrl && avatarUrl.length > 750000) throw new Error("Avatar image is too large");

  if (phone) {
    const existingPhone = await pool.query(QU.CHECK_PHONE_EXISTS_EXCLUDE_SELF, [phone, userId]);
    if (existingPhone.rows.length > 0) throw new Error("Phone already exists");
  }

  const result = await pool.query(QU.UPDATE_USER_PROFILE, [
    fullName, phone, dateOfBirth, gender, address, avatarUrl, userId,
  ]);

  if (result.rows.length === 0) throw new Error("User not found");
  return result.rows[0];
};

const changePassword = async (userId, oldPassword, newPassword, confirmPassword) => {
  if (!oldPassword || !newPassword || !confirmPassword) throw new Error("All fields are required");
  if (newPassword.length < 8) throw new Error("New password must be at least 8 characters");
  if (newPassword !== confirmPassword) throw new Error("Password and confirm password do not match");

  const result = await pool.query(QU.FIND_USER_BY_ID_SIMPLE, [userId]);
  if (result.rows.length === 0) throw new Error("User not found");

  const user = result.rows[0];
  if (!user.password_hash) throw new Error("Account does not have a password yet. Please use set-password first");

  const isMatch = await comparePassword(oldPassword, user.password_hash);
  if (!isMatch)             throw new Error("Old password is incorrect");
  if (oldPassword === newPassword) throw new Error("New password must be different from old password");

  const newPasswordHash = await hashPassword(newPassword);
  await pool.query(QU.UPDATE_USER_PASSWORD, [newPasswordHash, userId]);
  await revokeAllUserRefreshTokens(userId);
  return true;
};

const setPassword = async (userId, newPassword, confirmPassword) => {
  if (!newPassword || !confirmPassword) throw new Error("new_password and confirm_password are required");
  if (newPassword.length < 8) throw new Error("Password must be at least 8 characters");
  if (newPassword !== confirmPassword) throw new Error("Password and confirm password do not match");

  const result = await pool.query(QU.FIND_USER_BY_ID_SIMPLE, [userId]);
  if (result.rows.length === 0) throw new Error("User not found");

  const user = result.rows[0];
  if (user.password_hash) throw new Error("Password already exists for this account. Please use change-password");

  const newPasswordHash = await hashPassword(newPassword);
  await pool.query(QU.UPDATE_USER_PASSWORD, [newPasswordHash, userId]);
  await revokeAllUserRefreshTokens(userId);
  return true;
};

const resendRegisterOTP = async (email) => {
  if (!email) throw new Error("Email is required");

  const userResult = await pool.query(QU.FIND_USER_BY_EMAIL, [email]);
  if (userResult.rows.length === 0) throw new Error("User not found");

  const user = userResult.rows[0];
  if (user.email_verified) throw new Error("Email is already verified");

  const otp = generateOTP();
  await pool.query(QA.INSERT_REGISTER_OTP, [user.id, otp]);

  try {
    sendOTPEmail(user.email, otp);
  } catch (err) {
    console.log("❌ MAIL FAILED:", err.message);
  }

  return { email: user.email, otp };
};

module.exports = {
  registerUser,
  loginUser,
  verifyRegisterOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  getMe,
  updateProfile,
  changePassword,
  setPassword,
  issueAuthTokens,
  refreshUserSession,
  logoutUserSession,
  resendRegisterOTP,
};
