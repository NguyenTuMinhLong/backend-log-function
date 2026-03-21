// const nodemailer = require("nodemailer");
// const dns = require("dns");

// // 🔥 FIX IPv6 → IPv4 (Render rất cần)
// dns.setDefaultResultOrder("ipv4first");

// // ===== CREATE TRANSPORTER =====
// const transporter = nodemailer.createTransport({
//   service: "gmail", // 🔥 dùng cái này ổn định hơn host/port
//   auth: {
//     user: process.env.EMAIL_USER,
//     pass: process.env.EMAIL_PASS,
//   },
// });

// // ===== SEND OTP EMAIL =====
// const sendOTPEmail = async (email, otp) => {
//   try {
//     await transporter.sendMail({
//       from: `"Flight Booking" <${process.env.EMAIL_USER}>`,
//       to: email,
//       subject: "Your OTP Code",
//       html: `
//         <div style="font-family: Arial; text-align: center;">
//           <h2>✈️ Flight Booking</h2>
//           <p>Your verification code is:</p>
//           <h1 style="color: #007bff;">${otp}</h1>
//           <p>This code expires in 5 minutes.</p>
//         </div>
//       `,
//     });

//     console.log("✅ OTP email sent to:", email);
//   } catch (err) {
//     console.log("❌ FULL MAIL ERROR:", err); // 🔥 debug cực quan trọng
//   }
// };

// module.exports = { sendOTPEmail };


const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

// ===== SEND OTP EMAIL =====
const sendOTPEmail = async (email, otp) => {
  try {
    const response = await resend.emails.send({
      from: "Flight Booking <onboarding@resend.dev>", // ⚠️ dùng domain mặc định của Resend
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
    });

    console.log("✅ RESEND SUCCESS:", response);
  } catch (err) {
    console.error("❌ RESEND ERROR:", err);
    throw err; // 🔥 để controller bắt lỗi
  }
};

module.exports = { sendOTPEmail };