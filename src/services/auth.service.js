const { sendOTPEmail } = require("../utils/mailer");
const { generateOTP } = require("../utils/otp");
const pool = require("../config/db");
const { hashPassword, comparePassword } = require("../utils/password");

// const registerUser = async (data) => {
//   const { full_name, email, phone, password, confirm_password } = data;

//   if (!full_name || !email || !password || !confirm_password) {
//     throw new Error("Full name, email, password and confirm password are required");
//   }

//   if (password.length < 8) {
//     throw new Error("Password must be at least 8 characters");
//   }

//   if (password !== confirm_password) {
//     throw new Error("Password and confirm password do not match");
//   }

//   const existingEmail = await pool.query(
//     "SELECT id FROM users WHERE LOWER(email)=LOWER($1)",
//     [email]
//   );

//   if (existingEmail.rows.length > 0) {
//     throw new Error("Email already exists");
//   }

//   if (phone) {
//     const existingPhone = await pool.query(
//       "SELECT id FROM users WHERE phone = $1",
//       [phone]
//     );

//     if (existingPhone.rows.length > 0) {
//       throw new Error("Phone already exists");
//     }
//   }

//   const passwordHash = await hashPassword(password);

//   const userResult = await pool.query(
//     `INSERT INTO users (full_name, email, phone, password_hash)
//      VALUES ($1, $2, $3, $4)
//      RETURNING id, full_name, email, phone, email_verified`,
//     [full_name, email, phone || null, passwordHash]
//   );

//   const user = userResult.rows[0];
//   const otp = generateOTP();

//   await pool.query(
//     `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
//      VALUES ($1, $2, 'register_verify', 'email', NOW() + INTERVAL '5 minutes')`,
//     [user.id, otp]
//   );

//   await sendOTPEmail(user.email, otp);

//   return {
//     user,
//     otp
//   };
// };

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
    "SELECT id FROM users WHERE LOWER(email)=LOWER($1)",
    [email]
  );

  if (existingEmail.rows.length > 0) {
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

  // 🔥 GỬI MAIL (đã an toàn vì mailer có try-catch)
  await sendOTPEmail(user.email, otp);

  return {
    user,
    otp // dùng cho dev test
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

  return true;
};
const getMe = async (userId) => {
  const result = await pool.query(
    `SELECT id, full_name, email, phone, role, status, email_verified, phone_verified, created_at
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

  const latestOtpResult = await pool.query(
    `SELECT *
     FROM user_otps
     WHERE user_id = $1
       AND otp_type = 'register_verify'
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  );

  if (latestOtpResult.rows.length > 0) {
    const latestOtp = latestOtpResult.rows[0];
    const createdAt = new Date(latestOtp.created_at).getTime();
    const now = Date.now();
    const diffSeconds = Math.floor((now - createdAt) / 1000);

    if (diffSeconds < 60) {
      throw new Error(`Please wait ${60 - diffSeconds} seconds before requesting a new OTP`);
    }
  }

  const otp = generateOTP();

  await pool.query(
    `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
     VALUES ($1, $2, 'register_verify', 'email', NOW() + INTERVAL '5 minutes')`,
    [user.id, otp]
  );

  await sendOTPEmail(user.email, otp);

  return {
    email: user.email,
    otp
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
  resendRegisterOTP
};