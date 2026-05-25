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

// Solid airplane SVGs — used in Apple Mail, Samsung Mail; Gmail falls back to emoji text gracefully
const PLANE_ICON_WHITE = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white" style="display:inline-block;vertical-align:middle;margin-bottom:4px;"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
const PLANE_ICON_BLUE  = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#1a56db" style="display:inline-block;vertical-align:middle;"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;
const PLANE_ICON_GRAY  = `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="#9ca3af" style="display:inline-block;vertical-align:middle;"><path d="M21 16v-2l-8-5V3.5c0-.83-.67-1.5-1.5-1.5S10 2.67 10 3.5V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/></svg>`;

// Dark-mode overrides (Apple Mail, Samsung Mail, Outlook iOS support @media prefers-color-scheme)
const DARK_MODE_STYLE = `
<style type="text/css">
  @media (prefers-color-scheme: dark) {
    body, .em-body        { background-color: #0d1117 !important; }
    .em-card              { background-color: #161b22 !important; border-color: #30363d !important; box-shadow: none !important; }
    .em-header-light      { background-color: #1c2128 !important; border-color: #30363d !important; }
    .em-text-primary      { color: #f0f6fc !important; }
    .em-text-secondary    { color: #8b949e !important; }
    .em-text-muted        { color: #6e7681 !important; }
    .em-amount            { color: #58a6ff !important; }
    .em-expiry            { color: #ff7b72 !important; }
    .em-td-label          { color: #8b949e !important; }
    .em-td-value          { color: #c9d1d9 !important; }
    .em-td-border         { border-color: #21262d !important; }
    .em-section-title     { color: #f0f6fc !important; border-color: #1f6feb !important; }
    .em-flight-card       { background-color: #1c2128 !important; border-color: #30363d !important; }
    .em-flight-code       { color: #58a6ff !important; }
    .em-flight-airline    { color: #f0f6fc !important; }
    .em-flight-label      { color: #8b949e !important; }
    .em-flight-city       { color: #8b949e !important; }
    .em-flight-time       { color: #c9d1d9 !important; }
    .em-flight-seat       { color: #8b949e !important; }
    .em-pax-th            { color: #8b949e !important; background-color: #1c2128 !important; }
    .em-pax-td            { color: #c9d1d9 !important; border-color: #21262d !important; }
    .em-booking-box       { background-color: #1c2d3f !important; border-color: #1f6feb !important; }
    .em-booking-code      { color: #58a6ff !important; }
    .em-booking-hint      { color: #6e7681 !important; }
    .em-gateway-box       { background-color: #1c2128 !important; border-color: #30363d !important; }
    .em-gateway-label     { color: #8b949e !important; }
    .em-gateway-value     { color: #c9d1d9 !important; }
    .em-success-box       { background-color: #0d1f18 !important; border-color: #2ea043 !important; }
    .em-success-text      { color: #3fb950 !important; }
    .em-footer            { background-color: #1c2128 !important; border-color: #30363d !important; }
    .em-footer-text       { color: #6e7681 !important; }
  }
</style>
`;

const buildFlightSection = (prefix, b) => {
  const flightNum = b[`${prefix}_flight_number`];
  if (!flightNum) return "";
  const airline  = b[`${prefix}_airline_name`] || "";
  const depCity  = b[`${prefix}_dep_city`] || "";
  const arrCity  = b[`${prefix}_arr_city`] || "";
  const depCode  = b[`${prefix}_dep_code`] || "";
  const arrCode  = b[`${prefix}_arr_code`] || "";
  const depTime  = fmtDateTime(b[`${prefix}_departure_time`]);
  const arrTime  = fmtDateTime(b[`${prefix}_arrival_time`]);
  const seatClass = b[`${prefix}_seat_class`] || "";
  const label    = prefix === "outbound" ? "Chuyến đi" : "Chuyến về";

  return `
    <div class="em-flight-card" style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
      <div class="em-flight-label" style="font-size:12px;color:#6b7280;margin-bottom:6px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;">${label}</div>
      <div class="em-flight-airline" style="font-size:15px;font-weight:700;color:#111827;margin-bottom:4px;">${airline} · ${flightNum}</div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;">
        <div>
          <div class="em-flight-code" style="font-size:22px;font-weight:800;color:#1a56db;">${depCode}</div>
          <div class="em-flight-city" style="font-size:12px;color:#6b7280;">${depCity}</div>
          <div class="em-flight-time" style="font-size:12px;color:#374151;margin-top:2px;">${depTime}</div>
        </div>
        <div style="text-align:center;">${PLANE_ICON_BLUE}</div>
        <div style="text-align:right;">
          <div class="em-flight-code" style="font-size:22px;font-weight:800;color:#1a56db;">${arrCode}</div>
          <div class="em-flight-city" style="font-size:12px;color:#6b7280;">${arrCity}</div>
          <div class="em-flight-time" style="font-size:12px;color:#374151;margin-top:2px;">${arrTime}</div>
        </div>
      </div>
      ${seatClass ? `<div class="em-flight-seat" style="margin-top:8px;font-size:12px;color:#6b7280;">Hạng ghế: <strong>${seatClass}</strong></div>` : ""}
    </div>
  `;
};

const buildPassengerRows = (passengers) =>
  passengers.map((p) => `
    <tr>
      <td class="em-pax-td" style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#111827;">${p.full_name || "--"}</td>
      <td class="em-pax-td" style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#6b7280;text-align:center;">
        ${p.passenger_type === "adult" ? "Người lớn" : p.passenger_type === "child" ? "Trẻ em" : "Em bé"}
      </td>
      <td class="em-pax-td" style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:center;">${p.seat_number || "--"}</td>
      <td class="em-pax-td" style="padding:10px 12px;border-bottom:1px solid #f3f4f6;font-size:13px;color:#374151;text-align:center;">${p.baggage_kg ? `${p.baggage_kg} kg` : "--"}</td>
    </tr>
  `).join("");

// ─── E-ticket (after payment confirmed) ──────────────────────────────────────
const sendBookingConfirmedEmail = async (to, { bookingCode, contactName, finalAmount, paymentMethod, paidAt, booking, passengers }) => {
  try {
    const outboundHtml = buildFlightSection("outbound", booking);
    const returnHtml   = buildFlightSection("return", booking);

    const outboundPassengers = passengers.filter((p) => !p.flight_type || p.flight_type === "outbound");
    const returnPassengers   = passengers.filter((p) => p.flight_type === "return");

    const passengerTableHtml = (rows, title) => {
      if (!rows.length) return "";
      return `
        ${title ? `<h3 class="em-section-title" style="font-size:14px;color:#374151;margin:20px 0 8px;">${title}</h3>` : ""}
        <table class="em-pax-table" style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th class="em-pax-th" style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:left;font-weight:600;">Họ tên</th>
              <th class="em-pax-th" style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Loại</th>
              <th class="em-pax-th" style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Ghế</th>
              <th class="em-pax-th" style="padding:10px 12px;font-size:12px;color:#6b7280;text-align:center;font-weight:600;">Hành lý</th>
            </tr>
          </thead>
          <tbody>${buildPassengerRows(rows)}</tbody>
        </table>
      `;
    };

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  ${DARK_MODE_STYLE}
</head>
<body class="em-body" style="margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:600px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div class="em-card" style="background:#ffffff;margin:20px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">

      <!-- Header -->
      <div style="background:linear-gradient(135deg,#1a56db,#1e40af);padding:36px 24px;text-align:center;">
        <img src="https://iili.io/qvDF3Kl.png" width="100" style="margin-bottom:14px;display:block;margin-left:auto;margin-right:auto;" />
        <h1 style="color:#fff;font-size:22px;margin:0 0 6px;font-weight:700;">
          Đặt vé thành công! ${PLANE_ICON_WHITE}
        </h1>
        <p style="color:#bfdbfe;font-size:14px;margin:0;">Cảm ơn bạn đã tin tưởng Vivudee</p>
      </div>

      <!-- Body -->
      <div style="padding:28px 24px;">
        <p class="em-text-primary" style="color:#374151;font-size:15px;margin:0 0 20px;">
          Xin chào <strong>${contactName || "Quý khách"}</strong>,<br/>
          Thanh toán của bạn đã được xác nhận thành công.
        </p>

        <!-- Booking code box -->
        <div class="em-booking-box" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:20px;text-align:center;margin-bottom:24px;">
          <p class="em-text-muted" style="color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;font-weight:600;">Mã đặt vé của bạn</p>
          <p class="em-booking-code" style="color:#1a56db;font-size:32px;font-weight:800;letter-spacing:6px;margin:0;">${bookingCode}</p>
          <p class="em-booking-hint" style="color:#9ca3af;font-size:12px;margin:8px 0 0;">Vui lòng lưu mã này để làm thủ tục tại sân bay</p>
        </div>

        <!-- Payment summary -->
        <table style="width:100%;border-collapse:collapse;margin-bottom:24px;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr>
            <td class="em-td-label em-td-border" style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Số tiền đã thanh toán</td>
            <td class="em-amount em-td-border" style="padding:10px 16px;font-size:15px;color:#1a56db;font-weight:700;text-align:right;border-bottom:1px solid #f3f4f6;">${fmtCurrency(finalAmount)}</td>
          </tr>
          <tr>
            <td class="em-td-label em-td-border" style="padding:10px 16px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Phương thức thanh toán</td>
            <td class="em-td-value em-td-border" style="padding:10px 16px;font-size:13px;color:#374151;text-align:right;border-bottom:1px solid #f3f4f6;">${PAYMENT_METHOD_LABEL[paymentMethod] || paymentMethod || "--"}</td>
          </tr>
          <tr>
            <td class="em-td-label" style="padding:10px 16px;font-size:13px;color:#6b7280;">Thời gian xác nhận</td>
            <td class="em-td-value" style="padding:10px 16px;font-size:13px;color:#374151;text-align:right;">${fmtDateTime(paidAt)}</td>
          </tr>
        </table>

        <!-- Itinerary -->
        <h3 class="em-section-title" style="font-size:15px;color:#111827;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid #1a56db;">Hành trình</h3>
        ${outboundHtml}
        ${returnHtml}

        <!-- Passengers -->
        <h3 class="em-section-title" style="font-size:15px;color:#111827;margin:20px 0 12px;padding-bottom:8px;border-bottom:2px solid #1a56db;">Hành khách</h3>
        ${passengerTableHtml(outboundPassengers, outboundPassengers.length && returnPassengers.length ? "Chuyến đi" : "")}
        ${passengerTableHtml(returnPassengers, "Chuyến về")}

        <!-- Note -->
        <div class="em-success-box" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px;margin-top:24px;">
          <p class="em-success-text" style="color:#166534;font-size:13px;margin:0;">
            📩 Vui lòng lưu email này để làm thủ tục tại sân bay. Bạn có thể cần xuất trình mã đặt vé cùng giấy tờ tùy thân.
          </p>
        </div>
      </div>

      <!-- Footer -->
      <div class="em-footer" style="background:#f9fafb;padding:16px 24px;text-align:center;border-top:1px solid #e5e7eb;">
        <p class="em-footer-text" style="color:#9ca3af;font-size:12px;margin:0;">© ${new Date().getFullYear()} Vivudee · Đặt vé máy bay trực tuyến</p>
      </div>

    </div>
  </div>
</body>
</html>`;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject: `✈ Xác nhận đặt vé thành công — Mã booking: ${bookingCode}`,
      html,
    });

    if (error) { console.error("❌ sendBookingConfirmedEmail error:", error); return false; }
    console.log("✅ sendBookingConfirmedEmail sent:", data?.id);
    return true;
  } catch (err) {
    console.error("❌ sendBookingConfirmedEmail exception:", err);
    return false;
  }
};

// ─── OTP ─────────────────────────────────────────────────────────────────────
const sendOTPEmail = async (to, otp) => {
  try {
    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  ${DARK_MODE_STYLE}
</head>
<body class="em-body" style="margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:420px;margin:auto;">
    <div class="em-card" style="background:#ffffff;margin:20px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.08);text-align:center;padding:28px 24px;">
      <img src="https://iili.io/qvDF3Kl.png" width="100" style="display:block;margin:0 auto 16px;" />
      <p class="em-text-secondary" style="color:#555;font-size:14px;margin:0 0 16px;">Your verification code is:</p>
      <div class="em-booking-code" style="font-size:34px;font-weight:bold;letter-spacing:8px;margin:0 0 16px;color:#111;">${otp}</div>
      <p class="em-text-muted" style="color:#888;font-size:13px;margin:0 0 20px;">This code will expire in 5 minutes.</p>
      <div style="height:1px;background:#eee;margin:0 0 16px;"></div>
      <p class="em-footer-text" style="font-size:12px;color:#aaa;margin:0;">If you didn't request this, please ignore this email.</p>
    </div>
  </div>
</body>
</html>`;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject: "Your OTP Code",
      html,
    });

    if (error) { console.error("❌ Email error:", error); return false; }
    console.log("✅ Email sent:", data);
    return true;
  } catch (err) {
    console.error("❌ Exception:", err);
    return false;
  }
};

// ─── Gateway details box ──────────────────────────────────────────────────────
const buildGatewayDetailsBox = (paymentMethod, gatewayResponse = {}) => {
  const rows = [];

  if (paymentMethod === "PAYPAL") {
    if (gatewayResponse.order_id)    rows.push(["Order ID",      gatewayResponse.order_id]);
    if (gatewayResponse.amount)      rows.push(["Số tiền (USD)", `${gatewayResponse.amount} USD`]);
    if (gatewayResponse.currency)    rows.push(["Tiền tệ",       gatewayResponse.currency]);
    if (gatewayResponse.approve_url) rows.push(["Checkout URL",  `<a href="${gatewayResponse.approve_url}" style="color:#1a56db;">Mở PayPal thanh toán</a>`]);
  } else if (paymentMethod === "MOMO") {
    if (gatewayResponse.pay_url) rows.push(["Thanh toán MoMo", `<a href="${gatewayResponse.pay_url}" style="color:#a21caf;">Mở MoMo thanh toán</a>`]);
  } else if (paymentMethod === "BANK_QR" || paymentMethod === "BANK_TRANSFER") {
    if (gatewayResponse.checkout_url)  rows.push(["Checkout URL",  `<a href="${gatewayResponse.checkout_url}" style="color:#1a56db;">Mở trang thanh toán</a>`]);
    if (gatewayResponse.bank_account)  rows.push(["Số tài khoản",  gatewayResponse.bank_account]);
    if (gatewayResponse.description)   rows.push(["Nội dung CK",   `<strong>${gatewayResponse.description}</strong>`]);
  }

  if (!rows.length) return "";

  const bgColor     = paymentMethod === "MOMO" ? "#fdf4ff" : "#fff7ed";
  const borderColor = paymentMethod === "MOMO" ? "#e9d5ff" : "#fed7aa";

  return `
    <div class="em-gateway-box" style="background:${bgColor};border:1px solid ${borderColor};border-radius:8px;padding:16px;margin-top:20px;">
      <table style="width:100%;border-collapse:collapse;">
        ${rows.map(([label, value]) => `
          <tr>
            <td class="em-gateway-label" style="padding:5px 0;font-size:13px;color:#6b7280;white-space:nowrap;width:40%;">${label}</td>
            <td class="em-gateway-value" style="padding:5px 0;font-size:13px;color:#111827;word-break:break-all;">${value}</td>
          </tr>
        `).join("")}
      </table>
    </div>
  `;
};

// ─── Payment initiated email ──────────────────────────────────────────────────
const sendPaymentInitiatedEmail = async (to, { contactName, paymentCode, paymentMethod, finalAmount, expiresAt, gatewayResponse }) => {
  try {
    const expiryMinutes = (() => {
      if (!expiresAt) return 15;
      const diffMs = new Date(expiresAt) - new Date();
      return Math.max(1, Math.round(diffMs / 60000));
    })();

    const methodLabel = PAYMENT_METHOD_LABEL[paymentMethod] || paymentMethod || "--";
    const gatewayBox  = buildGatewayDetailsBox(paymentMethod, gatewayResponse || {});

    const html = `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  ${DARK_MODE_STYLE}
</head>
<body class="em-body" style="margin:0;padding:0;background:#f3f4f6;">
  <div style="max-width:560px;margin:auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
    <div class="em-card" style="background:#ffffff;margin:20px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.06);">

      <!-- Header -->
      <div class="em-header-light" style="background:#f9fafb;padding:28px 24px;text-align:center;border-bottom:1px solid #e5e7eb;">
        <img src="https://iili.io/qvDF3Kl.png" width="90" style="display:block;margin:0 auto;" />
      </div>

      <!-- Body -->
      <div style="padding:28px 24px;">
        <h3 class="em-text-primary" style="font-size:17px;color:#111827;text-align:center;margin:0 0 20px;font-weight:700;">
          Vui lòng hoàn tất thanh toán trong vòng <span class="em-expiry" style="color:#dc2626;">${expiryMinutes} phút</span>
        </h3>

        <p class="em-text-secondary" style="color:#6b7280;font-size:14px;margin:0 0 20px;">
          Xin chào <strong class="em-text-primary" style="color:#111827;">${contactName || "Quý khách"}</strong>,<br/>
          Giao dịch thanh toán của bạn đã được tạo thành công.
        </p>

        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <tr>
            <td class="em-td-label em-td-border" style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;width:40%;">Mã thanh toán</td>
            <td class="em-td-value em-td-border" style="padding:10px 14px;font-size:13px;color:#111827;font-weight:600;border-bottom:1px solid #f3f4f6;word-break:break-all;">${paymentCode}</td>
          </tr>
          <tr>
            <td class="em-td-label em-td-border" style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Phương thức</td>
            <td class="em-td-value em-td-border" style="padding:10px 14px;font-size:13px;color:#111827;border-bottom:1px solid #f3f4f6;">${methodLabel}</td>
          </tr>
          <tr>
            <td class="em-td-label em-td-border" style="padding:10px 14px;font-size:13px;color:#6b7280;border-bottom:1px solid #f3f4f6;">Số tiền</td>
            <td class="em-amount em-td-border" style="padding:10px 14px;font-size:15px;color:#1a56db;font-weight:700;border-bottom:1px solid #f3f4f6;">${fmtCurrency(finalAmount)}</td>
          </tr>
          <tr>
            <td class="em-td-label" style="padding:10px 14px;font-size:13px;color:#6b7280;">Hết hạn lúc</td>
            <td class="em-expiry" style="padding:10px 14px;font-size:13px;color:#dc2626;">${fmtDateTime(expiresAt)}</td>
          </tr>
        </table>

        ${gatewayBox}

        <p class="em-footer-text" style="color:#9ca3af;font-size:12px;text-align:center;margin:24px 0 0;">
          Nếu bạn đã hoàn tất thanh toán, vui lòng bỏ qua email này.<br/>
          Nếu bạn không thực hiện giao dịch này, cũng hãy bỏ qua email này.
        </p>
      </div>

    </div>
  </div>
</body>
</html>`;

    const { data, error } = await resend.emails.send({
      from: process.env.EMAIL_FROM,
      to,
      subject: `Xác nhận giao dịch — ${paymentCode}`,
      html,
    });

    if (error) { console.error("❌ sendPaymentInitiatedEmail error:", error); return false; }
    console.log("✅ sendPaymentInitiatedEmail sent:", data?.id);
    return true;
  } catch (err) {
    console.error("❌ sendPaymentInitiatedEmail exception:", err);
    return false;
  }
};

module.exports = { sendOTPEmail, sendPaymentInitiatedEmail, sendBookingConfirmedEmail };
