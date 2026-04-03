const express = require("express");
const router = express.Router();

const authController = require("../controllers/auth.controller");
const { authenticate } = require("../middlewares/auth.middleware");
const { authenticateSupabase } = require("../middlewares/supabase-auth.middleware");

router.post("/register", authController.register);
router.post("/login", authController.login);
router.post("/verify-register-otp", authController.verifyRegisterOTP);
router.post("/forgot-password", authController.forgotPassword);
router.post("/verify-reset-otp", authController.verifyResetOTP);
router.post("/reset-password", authController.resetPassword);
router.post("/refresh", authController.refreshToken);
router.get("/me", authenticate, authController.me);
router.post("/change-password", authenticate, authController.changePassword);
router.post("/set-password", authenticate, authController.setPassword);
router.post("/logout", authenticate, authController.logout);
router.post("/resend-otp", authController.resendOTP);

// social login qua Supabase
router.get("/social/me", authenticateSupabase, authController.socialMe);

module.exports = router;
