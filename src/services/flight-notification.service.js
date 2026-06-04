"use strict";

const pool = require("../config/db");
const { sendEmail } = require("./notification.service");

// ─── Notification Types ───────────────────────────────────────────────────────

const NOTIFICATION_TYPES = {
  STATUS_DELAYED:   'status_delayed',
  STATUS_CANCELLED: 'status_cancelled',
  STATUS_BOARDING:  'status_boarding',
  GATE_CHANGED:     'gate_changed',
  TIME_CHANGED:     'time_changed',
  BAGGAGE_CHANGED:  'baggage_changed',
};

// ─── Email Templates ──────────────────────────────────────────────────────────

const fmt = (d) => d ? new Date(d).toLocaleString('vi-VN', {
  year: 'numeric', month: 'long', day: 'numeric',
  hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh',
}) : 'Chưa xác định';

const buildEmailContent = (type, data) => {
  const { flight_number, booking_code, contact_name, reason } = data;
  const reasonLine = reason ? `\nLý do: ${reason}` : '';

  switch (type) {

    case NOTIFICATION_TYPES.STATUS_DELAYED:
      return {
        subject: `[Thông báo] Chuyến bay ${flight_number} bị TRỄ — Booking ${booking_code}`,
        body:
`Xin chào ${contact_name},

Chuyến bay ${flight_number} của bạn hiện đang bị TRỄ CHUYẾN.

📋 Mã booking : ${booking_code}
✈️  Chuyến bay : ${flight_number}
⏱️  Thời gian trễ : ${data.delay_minutes ? data.delay_minutes + ' phút' : 'Chưa xác định'}
🛫 Giờ khởi hành mới : ${fmt(data.new_departure_time)}${reasonLine}

Vui lòng theo dõi bảng thông báo tại sân bay để cập nhật thông tin mới nhất.
Chúng tôi xin lỗi vì sự bất tiện này.

Trân trọng,
Đội ngũ hỗ trợ`,
      };

    case NOTIFICATION_TYPES.STATUS_CANCELLED:
      return {
        subject: `[Quan trọng] Chuyến bay ${flight_number} bị HỦY — Booking ${booking_code}`,
        body:
`Xin chào ${contact_name},

Chúng tôi rất tiếc phải thông báo chuyến bay ${flight_number} đã bị HỦY.

📋 Mã booking : ${booking_code}
✈️  Chuyến bay : ${flight_number}${reasonLine}

Chúng tôi sẽ liên hệ trong 24h để hỗ trợ:
• Hoàn tiền đầy đủ, hoặc
• Đổi sang chuyến bay khác phù hợp

Vui lòng truy cập website với mã booking trên để theo dõi tiến trình.

Trân trọng,
Đội ngũ hỗ trợ`,
      };

    case NOTIFICATION_TYPES.STATUS_BOARDING:
      return {
        subject: `[Lên máy bay ngay] ${flight_number} đang BOARDING — Booking ${booking_code}`,
        body:
`Xin chào ${contact_name},

⚠️ Chuyến bay ${flight_number} đang MỞ CỔNG LÊN MÁY BAY!

📋 Mã booking : ${booking_code}
✈️  Chuyến bay : ${flight_number}
🚪 Cổng       : ${data.gate     || 'Xem bảng tại sân bay'}
🏢 Nhà ga     : ${data.terminal || 'Xem bảng tại sân bay'}
⏰ Thời gian  : ${fmt(data.boarding_time)}

Vui lòng đến cổng ngay với đầy đủ giấy tờ và thẻ lên máy bay.

Trân trọng,
Đội ngũ hỗ trợ`,
      };

    case NOTIFICATION_TYPES.GATE_CHANGED:
      return {
        subject: `[Đổi cổng] Chuyến bay ${flight_number} — Booking ${booking_code}`,
        body:
`Xin chào ${contact_name},

Chuyến bay ${flight_number} đã THAY ĐỔI CỔNG khởi hành.

📋 Mã booking : ${booking_code}
✈️  Chuyến bay : ${flight_number}
🚪 Cổng cũ   : ${data.old_gate || 'N/A'}
🚪 Cổng mới  : ${data.new_gate}
🏢 Nhà ga    : ${data.terminal || 'Xem bảng tại sân bay'}${reasonLine}

Vui lòng di chuyển đến cổng mới ngay lập tức.

Trân trọng,
Đội ngũ hỗ trợ`,
      };

    case NOTIFICATION_TYPES.TIME_CHANGED:
      return {
        subject: `[Đổi giờ bay] Chuyến bay ${flight_number} — Booking ${booking_code}`,
        body:
`Xin chào ${contact_name},

Chuyến bay ${flight_number} đã THAY ĐỔI GIỜ BAY.

📋 Mã booking           : ${booking_code}
✈️  Chuyến bay           : ${flight_number}
⏰ Giờ khởi hành cũ    : ${fmt(data.old_departure_time)}
⏰ Giờ khởi hành mới   : ${fmt(data.new_departure_time)}
🛬 Giờ hạ cánh mới     : ${fmt(data.new_arrival_time)}${reasonLine}

Nếu thay đổi không phù hợp, bạn có thể hủy vé và được hoàn tiền trong 48h.

Trân trọng,
Đội ngũ hỗ trợ`,
      };

    case NOTIFICATION_TYPES.BAGGAGE_CHANGED:
      return {
        subject: `[Cập nhật hành lý] Chuyến bay ${flight_number} — Booking ${booking_code}`,
        body:
`Xin chào ${contact_name},

Chính sách hành lý cho chuyến bay ${flight_number} đã được CẬP NHẬT.

📋 Mã booking               : ${booking_code}
✈️  Chuyến bay               : ${flight_number}
🧳 Hành lý ký gửi mới      : ${data.new_baggage_kg}kg (cũ: ${data.old_baggage_kg ?? 'N/A'}kg)
👜 Hành lý xách tay mới    : ${data.new_carry_on_kg}kg${reasonLine}

Vui lòng kiểm tra lại hành lý trước khi ra sân bay.

Trân trọng,
Đội ngũ hỗ trợ`,
      };

    default:
      return {
        subject: `[Thông báo] Cập nhật chuyến bay ${flight_number} — Booking ${booking_code}`,
        body: `Xin chào ${contact_name},\n\nChuyến bay ${flight_number} (booking ${booking_code}) có thay đổi.\n\nTrân trọng,\nĐội ngũ hỗ trợ`,
      };
  }
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const getAffectedBookings = async (flightId) => {
  const result = await pool.query(`
    SELECT DISTINCT
      b.id, b.booking_code, b.user_id,
      b.contact_email, b.contact_name, b.status
    FROM bookings b
    WHERE (b.outbound_flight_id = $1 OR b.return_flight_id = $1)
      AND b.status IN ('pending', 'confirmed')
  `, [flightId]);
  return result.rows;
};

const notifyBookings = async (bookings, type, extraData = {}) => {
  let sent = 0;
  for (const booking of bookings) {
    if (!booking.contact_email) continue;
    try {
      const content = buildEmailContent(type, {
        ...extraData,
        booking_code: booking.booking_code,
        contact_name: booking.contact_name,
      });
      // fire-and-forget
      sendEmail(booking.contact_email, content.subject, content.body)
        .catch(e => console.error(`[FlightNotif] Email ${booking.booking_code}:`, e.message));
      sent++;
    } catch (e) {
      console.error('[FlightNotif] Build error:', e.message);
    }
  }
  return sent;
};

// ─── Exported Functions ───────────────────────────────────────────────────────

/**
 * Gửi email khi đổi trạng thái (delayed / cancelled / boarding)
 */
const notifyStatusChange = async (flightId, flightNumber, status, extraData = {}) => {
  const typeMap = {
    delayed:   NOTIFICATION_TYPES.STATUS_DELAYED,
    cancelled: NOTIFICATION_TYPES.STATUS_CANCELLED,
    boarding:  NOTIFICATION_TYPES.STATUS_BOARDING,
  };
  const type = typeMap[status];
  if (!type) return { sent: 0, total: 0 }; // scheduled/completed không cần email

  const bookings = await getAffectedBookings(flightId);
  const sent = await notifyBookings(bookings, type, {
    flight_number: flightNumber, ...extraData,
  });
  console.log(`[FlightNotif] ${status} → ${sent}/${bookings.length} email`);
  return { sent, total: bookings.length };
};

/**
 * Gửi email khi đổi cổng
 */
const notifyGateChange = async (flightId, flightNumber, newGate, oldGate, terminal, reason) => {
  const bookings = await getAffectedBookings(flightId);
  const sent = await notifyBookings(bookings, NOTIFICATION_TYPES.GATE_CHANGED, {
    flight_number: flightNumber,
    new_gate: newGate, old_gate: oldGate, terminal, reason,
  });
  console.log(`[FlightNotif] gate_changed → ${sent}/${bookings.length} email`);
  return { sent, total: bookings.length };
};

/**
 * Gửi email khi đổi giờ bay
 */
const notifyTimeChange = async (flightId, flightNumber, oldDep, newDep, newArr, reason) => {
  const bookings = await getAffectedBookings(flightId);
  const sent = await notifyBookings(bookings, NOTIFICATION_TYPES.TIME_CHANGED, {
    flight_number:       flightNumber,
    old_departure_time:  oldDep,
    new_departure_time:  newDep,
    new_arrival_time:    newArr,
    reason,
  });
  console.log(`[FlightNotif] time_changed → ${sent}/${bookings.length} email`);
  return { sent, total: bookings.length };
};

/**
 * Gửi email khi thay đổi hành lý
 */
const notifyBaggageChange = async (flightId, flightNumber, seats, reason) => {
  const bookings = await getAffectedBookings(flightId);
  const seat = seats.find(s => s.class === 'economy') || seats[0];
  if (!seat) return { sent: 0, total: 0 };

  const sent = await notifyBookings(bookings, NOTIFICATION_TYPES.BAGGAGE_CHANGED, {
    flight_number:    flightNumber,
    old_baggage_kg:   seat.old_baggage_kg  ?? null,
    new_baggage_kg:   seat.new_baggage_kg,
    new_carry_on_kg:  seat.new_carry_on_kg,
    reason,
  });
  console.log(`[FlightNotif] baggage_changed → ${sent}/${bookings.length} email`);
  return { sent, total: bookings.length };
};

module.exports = {
  NOTIFICATION_TYPES,
  notifyStatusChange,
  notifyGateChange,
  notifyTimeChange,
  notifyBaggageChange,
};