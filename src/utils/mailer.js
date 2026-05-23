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
      max-width:420px;
      margin:auto;
      background:#ffffff;
      padding:24px;
      border-radius:12px;
      border:1px solid #eaeaea;
      box-shadow:0 4px 12px rgba(0,0,0,0.08);
      text-align:center;
    ">
      <img src="https://iili.io/qvDF3Kl.png" width="100" style="margin-bottom:10px;" />

      
      <p style="
        color:#555;
        font-size:14px;
      ">
        Your verification code is:
      </p>

      
      <div style="
        font-size:34px;
        font-weight:bold;
        letter-spacing:8px;
        margin:20px 0;
        color:#111;
      ">
        ${otp}
      </div>

      
      <p style="
        color:#888;
        font-size:13px;
      ">
        This code will expire in 5 minutes.
      </p>

      <!-- Divider -->
      <div style="
        height:1px;
        background:#eee;
        margin:20px 0;
      "></div>

      <!-- Footer -->
      <p style="
        font-size:12px;
        color:#aaa;
      ">
        If you didn’t request this, please ignore this email.
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

// QUAN TRỌNG

/**
 * Send OTP Email for Refund verification (via Resend)
 * Vietnamese template
 */
const sendRefundOTPEmail = async (to, otp, expiresIn = 5) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to: to,
      subject: `Ma xac thuc hoan tien - ${otp}`,
      html: `
  
    <div style="
      max-width:420px;
      margin:auto;
      background:#ffffff;
      padding:24px;
      border-radius:12px;
      border:1px solid #eaeaea;
      box-shadow:0 4px 12px rgba(0,0,0,0.08);
      text-align:center;
    ">
      <img src="https://iili.io/qvDF3Kl.png" width="100" style="margin-bottom:10px;" />

      <h2 style="color:#333;margin-bottom:20px;">Xac thuc yeu cau hoan tien</h2>

      <p style="
        color:#555;
        font-size:14px;
      ">
        Ma xac thuc cua ban la:
      </p>

      <div style="
        font-size:34px;
        font-weight:bold;
        letter-spacing:8px;
        margin:20px 0;
        color:#111;
      ">
        ${otp}
      </div>

      <p style="
        color:#888;
        font-size:13px;
      ">
        Ma nay co hieu luc trong ${expiresIn} phut.
        Vui long khong chia se ma nay voi bat ky ai.
      </p>

      <!-- Divider -->
      <div style="
        height:1px;
        background:#eee;
        margin:20px 0;
      "></div>

      <!-- Footer -->
      <p style="
        font-size:12px;
        color:#aaa;
      ">
        Neu ban khong yeu cau ma nay, vui long bo qua email.
      </p>

    </div>

`,
    });

    if (error) {
      console.error("Email error:", error);
      return false;
    }

    console.log("Refund OTP Email sent:", data);
    return true;
  } catch (err) {
    console.error("Exception:", err);
    return false;
  }
};

module.exports = { sendOTPEmail, sendRefundOTPEmail };