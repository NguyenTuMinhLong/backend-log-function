const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTPEmail = async (to, otp) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: "Your OTP Code",
      html: `
        <div style="
          max-width:400px;
          margin:auto;
          padding:20px;
          font-family:sans-serif;
          text-align:center;
          border:1px solid #eee;
          border-radius:12px;
        ">
          <h2 style="color:#1a73e8;">✈️ Vivudee</h2>
          
          <p style="color:#555;">
            Your verification code is:
          </p>

          <div style="
            font-size:32px;
            font-weight:bold;
            letter-spacing:4px;
            color:#111;
            margin:20px 0;
          ">
            ${otp}
          </div>

          <p style="color:#999; font-size:12px;">
            This code will expire in 5 minutes.
          </p>
        </div>
      `,
    });

    if (error) {
      console.error("❌ Email error:", error);
      return false;
    }

    console.log("✅ Email sent:", data);
    return true;
  } catch (err) {
    console.error("❌ Exception:", err);
    return false;
  }
};

// 🔥 QUAN TRỌNG
module.exports = { sendOTPEmail };