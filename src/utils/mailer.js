const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const sendOTPEmail = async (email, otp) => {

  const mailOptions = {
    from: `"Flight Booking" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Your OTP Code",
    html: `
      <h2>Flight Booking OTP</h2>
      <p>Your verification code is:</p>
      <h1>${otp}</h1>
      <p>This code expires in 5 minutes.</p>
    `
  };

  await transporter.sendMail(mailOptions);
};

module.exports = { sendOTPEmail };