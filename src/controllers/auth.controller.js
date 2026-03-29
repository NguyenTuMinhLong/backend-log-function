const authService = require("../services/auth.service");
const { generateToken } = require("../utils/jwt");

const register = async (req, res) => {
  try {
    const result = await authService.registerUser(req.body);
    res.status(201).json({
      message: "Register successful. Please verify your email with OTP.",
      user: result.user,
      otp_test: result.otp,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const login = async (req, res) => {
  try {
    const user  = await authService.loginUser(req.body);
    const token = generateToken(user);
    res.json({
      message: "Login success",
      token,
      user: {
        id:             user.id,
        full_name:      user.full_name,
        email:          user.email,
        phone:          user.phone,
        role:           user.role,
        status:         user.status,
        email_verified: user.email_verified,
        avatar_url:     user.avatar_url || null,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const verifyRegisterOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    await authService.verifyRegisterOTP(email, otp);
    res.json({ message: "Email verified successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.forgotPassword(email);
    res.json({ message: "Reset OTP sent to email", otp_test: result.otp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const verifyResetOTP = async (req, res) => {
  try {
    const { email, otp } = req.body;
    await authService.verifyResetOTP(email, otp);
    res.json({ message: "OTP verified. You can now reset your password." });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const { email, otp, new_password, confirm_password } = req.body;
    await authService.resetPassword(email, otp, new_password, confirm_password);
    res.json({ message: "Password reset successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const me = async (req, res) => {
  try {
    const user = await authService.getMe(req.user.id);
    res.json({ message: "Get profile success", user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { old_password, new_password, confirm_password } = req.body;
    await authService.changePassword(req.user.id, old_password, new_password, confirm_password);
    res.json({ message: "Password changed successfully" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const logout = async (req, res) => {
  try {
    res.json({ message: "Logout successful" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const resendOTP = async (req, res) => {
  try {
    const { email } = req.body;
    const result = await authService.resendRegisterOTP(email);
    res.json({ message: "OTP resent successfully", email: result.email, otp_test: result.otp });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

/**
 * FIX: socialMe — trước đây không trả JWT token
 * Backend nhận Supabase access_token (qua header Authorization)
 * → supabase-auth.middleware verify + tạo/update user trong DB
 * → socialMe trả JWT hệ thống để frontend lưu vào localStorage
 */
const socialMe = async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ error: "User not found" });

    // Generate JWT của hệ thống (không phải Supabase token)
    const token = generateToken(user);

    res.json({
      message: "Social login success",
      token, // FIX: trả token để frontend lưu
      user: {
        id:             user.id,
        full_name:      user.full_name,
        email:          user.email,
        phone:          user.phone,
        role:           user.role,
        status:         user.status,
        email_verified: user.email_verified,
        auth_provider:  user.auth_provider,
        avatar_url:     user.avatar_url || null,
      },
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  register,
  login,
  verifyRegisterOTP,
  forgotPassword,
  verifyResetOTP,
  resetPassword,
  me,
  changePassword,
  logout,
  resendOTP,
  socialMe,
};