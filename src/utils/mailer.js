const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

export const sendOTPEmail = async (to, otp) => {
  try {
    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM, // 🔥 dùng env
      to: to,
      subject: "Your OTP Code",
      html: `
        <h2>Vivudee OTP</h2>
        <p>Your OTP is: <strong>${otp}</strong></p>
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