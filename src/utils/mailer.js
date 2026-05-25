const { Resend } = require("resend");

const resend = new Resend(process.env.RESEND_API_KEY);

const fmtCurrency = (amount) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(Number(amount || 0));

const fmtDateTime = (iso) => {
  if (!iso) return "--";
  return new Date(iso).toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
};

const PAYMENT_METHOD_LABEL = {
  BANK_QR: "Chuyển khoản QR",
  BANK_TRANSFER: "Chuyển khoản ngân hàng",
  MOMO: "Ví MoMo",
  PAYPAL: "PayPal",
};

const buildFlightSection = (prefix, b) => {
  const flightNum = b[`${prefix}_flight_number`];
  if (!flightNum) return "";
  const airline = b[`${prefix}_airline_name`] || "";
  const depCity = `${b[`${prefix}_dep_city`] || ""}`;
  const arrCity = `${b[`${prefix}_arr_city`] || ""}`;
  const depCode = b[`${prefix}_dep_code`] || "";
  const arrCode = b[`${prefix}_arr_code`] || "";
  const depTime = fmtDateTime(b[`${prefix}_departure_time`]);
  const arrTime = fmtDateTime(b[`${prefix}_arrival_time`]);
  const seatClass = b[`${prefix}_seat_class`] || "";
  const label = prefix === "outbound" ? "Chuyến đi" : "Chuyến về";

  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
      <div style="font-size:12px;color:#6b7280;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
      <div style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">${airline} · ${flightNum}</div>
      <div style="display:flex;justify-content:space-between;margin-top:10px;">
        <div>
          <div style="font-size:22px;font-weight:800;color:#1a56db;">${depCode}</div>
          <div style="font-size:12px;color:#6b7280;">${depCity}</div>
          <div style="font-size:12px;color:#374151;margin-top:2px;">${depTime}</div>
        </div>
        <div style="text-align:center;padding-top:6px;">
          <div style="color:#9ca3af;font-size:18px;">✈</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:22px;font-weight:800;color:#1a56db;">${arrCode}</div>
          <div style="font-size:12px;color:#6b7280;">${arrCity}</div>
          <div style="font-size:12px;color:#374151;margin-top:2px;">${arrTime}</div>
        </div>
      </div>
      ${seatClass ? `<div style="margin-top:8px;font-size:12px;color:#6b7280;">Hạng ghế: <strong>${seatClass}</strong></div>` : ""}
    </div>
  `;
};

const buildPassengerRows = (passengers) =>
  passengers
    .map(
      (p) => `
    <tr>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">${p.full_name || "--"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;text-align:center;">
        ${p.passenger_type === "adult" ? "Người lớn" : p.passenger_type === "child" ? "Trẻ em" : "Em bé"}
      </td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:center;">${p.seat_number || "--"}</td>
      <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:center;">${p.baggage_kg ? `${p.baggage_kg} kg` : "--"}</td>
    </tr>
  `
    )
    .join("");

const sendBookingConfirmedEmail = async (to, { bookingCode, contactName, finalAmount, paymentMethod, paidAt, booking, passengers }) => {
  try {
    const outboundHtml = buildFlightSection("outbound", booking);
    const returnHtml = buildFlightSection("return", booking);

    const outboundPassengers = passengers.filter(
      (p) => !p.flight_type || p.flight_type === "outbound"
    );
    const returnPassengers = passengers.filter((p) => p.flight_type === "return");

    const passengerTableHtml = (rows, title) => {
      if (!rows.length) return "";
      return `
        <h3 style="font-size:14px;color:#374151;margin:20px 0 8px;">${title}</h3>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:600;">Họ tên</th>
              <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Loại</th>
              <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Ghế</th>
              <th style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Hành lý</th>
            </tr>
          </thead>
          <tbody>${buildPassengerRows(rows)}</tbody>
        </table>
      `;
    };

    const html = `
      <div style="max-width:600px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;background:#ffffff;">
        <div style="background:linear-gradient(135deg,#1a56db,#1e40af);padding:32px 24px;text-align:center;">
          <img src="https://iili.io/qvDF3Kl.png" width="72" style="margin-bottom:12px;" />
          <h1 style="color:#fff;font-size:22px;margin:0 0 4px;">Đặt vé thành công! ✈</h1>
          <p style="color:#bfdbfe;font-size:14px;margin:0;">Cảm ơn bạn đã tin tưởng Vivudee</p>
        </div>

        <div style="padding:28px 24px;">
          <p style="color:#374151;font-size:15px;margin:0 0 20px;">
            Xin chào <strong>${contactName || "Quý khách"}</strong>,<br/>
            Thanh toán của bạn đã được xác nhận thành công.
          </p>

          <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
            <p style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;font-weight:600;">Mã đặt vé của bạn</p>
            <p style="color:#1a56db;font-size:32px;font-weight:800;letter-spacing:6px;margin:0;">${bookingCode}</p>
            <p style="color:#9ca3af;font-size:12px;margin:8px 0 0;">Vui lòng lưu mã này để làm thủ tục tại sân bay</p>
          </div>

          <table style="width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;">
            <tr>
              <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Số tiền đã thanh toán</td>
              <td style="padding:10px 16px;font-size:15px;color:#1a56db;font-weight:700;text-align:right;border-bottom:1px solid #f3f4f6;">${fmtCurrency(finalAmount)}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Phương thức thanh toán</td>
              <td style="padding:10px 16px;font-size:13px;color:#374151;text-align:right;border-bottom:1px solid #f3f4f6;">${PAYMENT_METHOD_LABEL[paymentMethod] || paymentMethod || "--"}</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;font-size:13px;color:#6b7280;">Thời gian xác nhận</td>
              <td style="padding:10px 16px;font-size:13px;color:#374151;text-align:right;">${fmtDateTime(paidAt)}</td>
            </tr>
          </table>

          <h3 style="font-size:15px;color:#111827;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #1a56db;">Hành trình</h3>
          ${outboundHtml}
          ${returnHtml}

          <h3 style="font-size:15px;color:#111827;margin:20px 0 12px;padding-bottom:8px;border-bottom:2px solid #1a56db;">Hành khách</h3>
          ${passengerTableHtml(outboundPassengers, outboundPassengers.length && returnPassengers.length ? "Chuyến đi" : "")}
          ${passengerTableHtml(returnPassengers, "Chuyến về")}

          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-top:24px;">
            <p style="color:#166534;font-size:13px;margin:0;">
              📩 Vui lòng lưu email này để làm thủ tục tại sân bay. Bạn có thể cần xuất trình mã đặt vé cùng giấy tờ tùy thân.
            </p>
          </div>
        </div>

        <div style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;">
          <p style="color:#9ca3af;font-size:12px;margin:0;">© ${new Date().getFullYear()} Vivudee · Đặt vé máy bay trực tuyến</p>
        </div>
      </div>
    `;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject: `✈ Xác nhận đặt vé thành công — Mã booking: ${bookingCode}`,
      html,
    });

    if (error) {
      console.error("❌ sendBookingConfirmedEmail error:", error);
      return false;
    }
    console.log("✅ sendBookingConfirmedEmail sent:", data?.id);
    return true;
  } catch (err) {
    console.error("❌ sendBookingConfirmedEmail exception:", err);
    return false;
  }
};

const sendOTPEmail = async (to, otp) => {
  console.log(`[MAILER] sendOTPEmail called with to: ${to}, otp: ${otp}`);
  try {
    console.log(`[MAILER] Sending via Resend with key: ${process.env.RESEND_API_KEY ? 'SET' : 'NOT SET'}`);
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

// Refund OTP - alias cua sendOTPEmail
const sendRefundOTPEmail = async (to, otp, expiresIn = 5) => {
  console.log(`[MAILER] sendRefundOTPEmail called`);
  return await sendOTPEmail(to, otp);
};

// 🔥 QUAN TRỌNG
module.exports = { 
  sendOTPEmail,
  sendRefundOTPEmail
};