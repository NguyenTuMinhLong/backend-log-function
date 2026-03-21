const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const sendOTPEmail = async (email, otp) => {
  try {
    const response = await resend.emails.send({
      from: "onboarding@resend.dev", // ⚠️ dùng tạm
      to: email,
      subject: "Your OTP Code",
      html: `
        <div style="text-align:center;font-family:sans-serif">
          <h2>✈️ Flight Booking</h2>
          <p>Your OTP is:</p>
          <h1>${otp}</h1>
          <p>Expires in 5 minutes</p>
        </div>
      `,
    });

    console.log("✅ RESEND SUCCESS:", response);
  } catch (err) {
    console.log("❌ RESEND ERROR:", err);
  }
};

module.exports = { sendOTPEmail };