const authService = require("../services/auth.service");
const { generateToken } = require("../utils/jwt");

const register = async (req, res) => {
  try {
    const result = await authService.registerUser(req.body);

    res.json({
      message: "Register success. Verify OTP.",
      user: result.user,
      otp_test: result.otp
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
};

const login = async (req, res) => {
  try {
    const user = await authService.loginUser(req.body);

    const token = generateToken(user);

    res.json({
      message: "Login success",
      token,
    });
  } catch (err) {
    res.status(400).json({
      error: err.message,
    });
  }
};

const verifyRegisterOTP = async (req, res) => {
  try {

    const { email, otp } = req.body;

    await authService.verifyRegisterOTP(email, otp);

    res.json({
      message: "Email verified successfully"
    });

  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    const result = await authService.forgotPassword(email);

    res.json({
      message: "Reset OTP sent to email",
      otp_test: result.otp
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
};

const verifyResetOTP = async (req, res) => {

  try {

    const { email, otp } = req.body;

    await authService.verifyResetOTP(email, otp);

    res.json({
      message: "OTP verified"
    });

  } catch (err) {

    res.status(400).json({
      error: err.message
    });

  }

};
const resetPassword = async (req, res) => {

  try {

    const { email, new_password } = req.body;

    await authService.resetPassword(email, new_password);

    res.json({
      message: "Password reset successful"
    });

  } catch (err) {

    res.status(400).json({
      error: err.message
    });

  }

};

const me = async (req, res) => {
  try {
    const user = await authService.getMe(req.user.id);

    res.json({
      message: "Get profile success",
      user
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
};

const changePassword = async (req, res) => {
  try {
    const { old_password, new_password } = req.body;

    await authService.changePassword(
      req.user.id,
      old_password,
      new_password
    );

    res.json({
      message: "Password changed successfully"
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
  }
};

const logout = async (req, res) => {
  try {
    res.json({
      message: "Logout successful"
    });
  } catch (err) {
    res.status(400).json({
      error: err.message
    });
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
  logout
};