const nodemailer = require("nodemailer");
const dns = require("dns");

// 🔥 FIX IPv6 → IPv4 (rất quan trọng khi deploy Render)
dns.setDefaultResultOrder("ipv4first");

// ===== CREATE TRANSPORTER =====
const transporter = nodemailer.createTransport({
  host: "smtp.gmail.com",
  port: 587,
  secure: false, // dùng TLS
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ===== SEND OTP EMAIL =====
const sendOTPEmail = (email, otp) => {
  const mailOptions = {
    from: `"Flight Booking" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    html: `
      <div style="font-family: Arial; text-align: center;">
        <h2>✈️ Flight Booking</h2>
        <p>Your verification code is:</p>
        <h1 style="color: #007bff;">${otp}</h1>
        <p>This code expires in 5 minutes.</p>
      </div>
    `,
  };

  // 🔥 GỬI MAIL ASYNC (KHÔNG BLOCK API)
  transporter
    .sendMail(mailOptions)
    .then(() => {
      console.log("✅ OTP email sent to:", email);
    })
    .catch((err) => {
      console.log("❌ Mail error:", err.message);
    });
};

module.exports = { sendOTPEmail };