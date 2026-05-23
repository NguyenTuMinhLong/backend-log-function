'use strict';

/*
=========================================================
NOTIFICATION SERVICE - Email Notifications
=========================================================

Gửi email khi có sự kiện liên quan đến:
- Refunds
- Date Changes
- Airline Cancellations
=========================================================
*/

const { NOTIFICATIONS } = require('../config/refund.config');

// Email sender address
const FROM_EMAIL = NOTIFICATIONS.email.from || 'no-reply@n4minhlong.io.vn';
const FROM_NAME = NOTIFICATIONS.email.fromName || 'Airline Booking System';

// =========================================================
// EMAIL TEMPLATES
// =========================================================

const EMAIL_TEMPLATES = {
  // Refund Templates
  REFUND_REQUESTED: {
    subject: 'Xác nhận yêu cầu hoàn tiền - {refund_code}',
    template: 'refund-requested',
  },
  REFUND_APPROVED: {
    subject: 'Yêu cầu hoàn tiền đã được duyệt - {refund_code}',
    template: 'refund-approved',
  },
  REFUND_REJECTED: {
    subject: 'Yêu cầu hoàn tiền bị từ chối - {refund_code}',
    template: 'refund-rejected',
  },
  REFUND_COMPLETED: {
    subject: 'Hoàn tiền thành công - {refund_code}',
    template: 'refund-completed',
  },
  REFUND_FAILED: {
    subject: 'Hoàn tiền thất bại - {refund_code}',
    template: 'refund-failed',
  },

  // Date Change Templates
  DATE_CHANGE_REQUESTED: {
    subject: 'Xác nhận yêu cầu đổi ngày bay - {request_code}',
    template: 'date-change-requested',
  },
  DATE_CHANGE_APPROVED: {
    subject: 'Yêu cầu đổi ngày bay đã được duyệt - {request_code}',
    template: 'date-change-approved',
  },
  DATE_CHANGE_REJECTED: {
    subject: 'Yêu cầu đổi ngày bay bị từ chối - {request_code}',
    template: 'date-change-rejected',
  },

  // Flight Cancellation Templates
  FLIGHT_CANCELLED: {
    subject: 'Thông báo: Chuyến bay {flight_number} đã bị hủy',
    template: 'flight-cancelled',
  },
  BOOKING_AFFECTED_BY_CANCELLATION: {
    subject: 'Thông tin hoàn tiền cho booking {booking_code}',
    template: 'booking-refund-notice',
  },
};

// =========================================================
// EMAIL CONTENT GENERATORS
// =========================================================

const generateRefundEmailContent = (event, data) => {
  const { refund, booking, adminId } = data;

  const baseData = {
    refund_code: refund.refund_code,
    booking_code: booking?.booking_code || refund.booking_code,
    refund_amount: formatCurrency(refund.net_refund_amount || refund.refund_amount),
    refund_type: refund.refund_type,
    status: refund.status,
    admin_notes: refund.admin_notes || '',
    created_at: formatDate(refund.created_at),
    completed_at: refund.completed_at ? formatDate(refund.completed_at) : null,
  };

  switch (event) {
    case 'REFUND_REQUESTED':
      return {
        subject: EMAIL_TEMPLATES.REFUND_REQUESTED.subject.replace('{refund_code}', refund.refund_code),
        body: `
          Xin chào,

          Chúng tôi đã tiếp nhận yêu cầu hoàn tiền của bạn.

          Thông tin yêu cầu:
          - Mã yêu cầu: ${refund.refund_code}
          - Mã booking: ${booking?.booking_code || refund.booking_code}
          - Loại refund: ${refund.refund_type}
          - Số tiền hoàn: ${formatCurrency(refund.net_refund_amount || refund.refund_amount)}
          - Ngày yêu cầu: ${formatDate(refund.created_at)}
          - Lý do: ${refund.reason || 'Không có'}

          Chúng tôi sẽ xử lý yêu cầu trong vòng 7 ngày làm việc.

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    case 'REFUND_APPROVED':
      return {
        subject: EMAIL_TEMPLATES.REFUND_APPROVED.subject.replace('{refund_code}', refund.refund_code),
        body: `
          Xin chào,

          Yêu cầu hoàn tiền của bạn đã được duyệt.

          Thông tin:
          - Mã yêu cầu: ${refund.refund_code}
          - Mã booking: ${booking?.booking_code || refund.booking_code}
          - Số tiền hoàn: ${formatCurrency(refund.net_refund_amount || refund.refund_amount)}
          - Ghi chú: ${refund.admin_notes || 'Không có'}

          Tiền sẽ được hoàn trong vòng 3-5 ngày làm việc.

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    case 'REFUND_REJECTED':
      return {
        subject: EMAIL_TEMPLATES.REFUND_REJECTED.subject.replace('{refund_code}', refund.refund_code),
        body: `
          Xin chào,

          Rất tiếc, yêu cầu hoàn tiền của bạn đã bị từ chối.

          Thông tin:
          - Mã yêu cầu: ${refund.refund_code}
          - Mã booking: ${booking?.booking_code || refund.booking_code}
          - Lý do từ chối: ${refund.admin_notes || refund.reason || 'Không có'}

          Nếu bạn cần hỗ trợ thêm, vui lòng liên hệ với chúng tôi.

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    case 'REFUND_COMPLETED':
      return {
        subject: EMAIL_TEMPLATES.REFUND_COMPLETED.subject.replace('{refund_code}', refund.refund_code),
        body: `
          Xin chào,

          Hoàn tiền đã được xử lý thành công!

          Thông tin:
          - Mã yêu cầu: ${refund.refund_code}
          - Mã booking: ${booking?.booking_code || refund.booking_code}
          - Số tiền hoàn: ${formatCurrency(refund.net_refund_amount)}
          - Ngày hoàn tiền: ${formatDate(refund.completed_at)}

          Tiền sẽ được ghi có vào tài khoản của bạn trong 3-5 ngày làm việc.

          Cảm ơn bạn đã sử dụng dịch vụ của chúng tôi.

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    default:
      return {
        subject: `Cập nhật về yêu cầu hoàn tiền ${refund.refund_code}`,
        body: `Có cập nhật mới về yêu cầu hoàn tiền của bạn.`,
      };
  }
};

const generateDateChangeEmailContent = (event, data) => {
  const { request, booking } = data;

  switch (event) {
    case 'DATE_CHANGE_REQUESTED':
      return {
        subject: EMAIL_TEMPLATES.DATE_CHANGE_REQUESTED.subject.replace('{request_code}', request.request_code),
        body: `
          Xin chào,

          Chúng tôi đã tiếp nhận yêu cầu đổi ngày bay của bạn.

          Thông tin:
          - Mã yêu cầu: ${request.request_code}
          - Mã booking: ${booking?.booking_code || request.booking_code}
          - Ngày yêu cầu: ${formatDate(request.created_at)}

          Chúng tôi sẽ xử lý trong vòng 24 giờ.

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    case 'DATE_CHANGE_APPROVED':
      return {
        subject: EMAIL_TEMPLATES.DATE_CHANGE_APPROVED.subject.replace('{request_code}', request.request_code),
        body: `
          Xin chào,

          Yêu cầu đổi ngày bay của bạn đã được duyệt!

          Thông tin:
          - Mã yêu cầu: ${request.request_code}
          - Mã booking: ${booking?.booking_code || request.booking_code}
          - Ghi chú: ${request.admin_notes || 'Không có'}

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    case 'DATE_CHANGE_REJECTED':
      return {
        subject: EMAIL_TEMPLATES.DATE_CHANGE_REJECTED.subject.replace('{request_code}', request.request_code),
        body: `
          Xin chào,

          Rất tiếc, yêu cầu đổi ngày bay của bạn đã bị từ chối.

          Thông tin:
          - Mã yêu cầu: ${request.request_code}
          - Mã booking: ${booking?.booking_code || request.booking_code}
          - Lý do: ${request.admin_notes || 'Không có'}

          Nếu bạn cần hỗ trợ thêm, vui lòng liên hệ với chúng tôi.

          Trân trọng,
          Đội ngũ hỗ trợ
        `.trim(),
      };

    default:
      return {
        subject: `Cập nhật về yêu cầu đổi ngày bay ${request.request_code}`,
        body: `Có cập nhật mới về yêu cầu đổi ngày bay của bạn.`,
      };
  }
};

const generateFlightCancellationEmailContent = (data) => {
  const { flight, booking, refund } = data;

  return {
    subject: EMAIL_TEMPLATES.BOOKING_AFFECTED_BY_CANCELLATION.subject.replace('{booking_code}', booking?.booking_code),
    body: `
      Xin chào,

      Chúng tôi xin thông báo rằng chuyến bay ${flight?.flight_number || ''} đã bị hủy bởi hãng hàng không.

      Thông tin booking của bạn:
      - Mã booking: ${booking?.booking_code || ''}
      - Chuyến bay: ${flight?.flight_number || ''}

      ${refund ? `
      Yêu cầu hoàn tiền đã được tạo tự động:
      - Mã hoàn tiền: ${refund.refund_code}
      - Số tiền hoàn: ${formatCurrency(refund.net_refund_amount)}
      ` : ''}

      Nếu bạn cần hỗ trợ thêm, vui lòng liên hệ với chúng tôi.

      Trân trọng,
      Đội ngũ hỗ trợ
    `.trim(),
  };
};

// =========================================================
// SEND EMAIL (MOCK - Cần implement với provider thực tế)
// =========================================================

const sendEmail = async (to, subject, body, options = {}) => {
  // TODO: Implement với email provider thực tế
  // Ví dụ: SendGrid, Mailgun, AWS SES, Nodemailer, etc.

  if (!NOTIFICATIONS.email.enabled) {
    console.log('[Email] Notifications disabled, skipping email');
    return false;
  }

  // Mock implementation
  console.log('[Email] Sending email:');
  console.log(`  From: ${FROM_NAME} <${FROM_EMAIL}>`);
  console.log(`  To: ${to}`);
  console.log(`  Subject: ${subject}`);
  console.log(`  Body: ${body.substring(0, 100)}...`);

  // Simulate async operation
  await new Promise(resolve => setTimeout(resolve, 50));

  return true;
};

// =========================================================
// NOTIFICATION FUNCTIONS
// =========================================================

const createRefundNotification = async (data) => {
  const { event, refund, booking, userId, guestEmail } = data;

  if (!NOTIFICATIONS.email.enabled) return;

  // Check if this event type should send notification
  const eventConfig = {
    REFUND_REQUESTED: NOTIFICATIONS.email.sendRefundRequestedConfirmation,
    REFUND_APPROVED: NOTIFICATIONS.email.sendRefundApprovedNotification,
    REFUND_REJECTED: NOTIFICATIONS.email.sendRefundRejectedNotification,
    REFUND_COMPLETED: NOTIFICATIONS.email.sendRefundCompletedNotification,
    REFUND_FAILED: NOTIFICATIONS.email.sendRefundFailedNotification,
  };

  if (!eventConfig[event]) return;

  // Get recipient email - priority: guestEmail > refund.guest_email > refund.user_email > booking.contact_email
  const recipientEmail = guestEmail || refund?.guest_email || refund?.user_email || booking?.contact_email;
  if (!recipientEmail) {
    console.warn('[Notification] No recipient email found');
    return;
  }

  // Generate email content
  const content = generateRefundEmailContent(event, { refund, booking, userId });

  // Send email
  await sendEmail(recipientEmail, content.subject, content.body);

  // Log for admin dashboard if enabled
  if (NOTIFICATIONS.admin.alertOnNewRefund && event === 'REFUND_REQUESTED') {
    console.log(`[Admin Alert] New refund request: ${refund.refund_code}`);
  }
};

const createDateChangeNotification = async (data) => {
  const { event, request, booking, userId } = data;

  if (!NOTIFICATIONS.email.enabled) return;

  // Check if this event type should send notification
  const eventConfig = {
    DATE_CHANGE_REQUESTED: NOTIFICATIONS.email.sendDateChangeRequestedConfirmation,
    DATE_CHANGE_APPROVED: NOTIFICATIONS.email.sendDateChangeApprovedNotification,
    DATE_CHANGE_REJECTED: NOTIFICATIONS.email.sendDateChangeRejectedNotification,
  };

  if (!eventConfig[event]) return;

  // Get recipient email
  const recipientEmail = request?.user_email || booking?.contact_email;
  if (!recipientEmail) {
    console.warn('[Notification] No recipient email found');
    return;
  }

  // Generate email content
  const content = generateDateChangeEmailContent(event, { request, booking, userId });

  // Send email
  await sendEmail(recipientEmail, content.subject, content.body);
};

const createFlightCancellationNotification = async (data) => {
  const { flight, bookings, refunds } = data;

  if (!NOTIFICATIONS.email.enabled || !NOTIFICATIONS.email.sendFlightCancelledNotifications) {
    return;
  }

  // Send notification to each affected booking
  for (let i = 0; i < bookings.length; i++) {
    const booking = bookings[i];
    const refund = refunds?.[i];

    const recipientEmail = booking.contact_email;
    const content = generateFlightCancellationEmailContent({
      flight,
      booking,
      refund,
    });

    await sendEmail(recipientEmail, content.subject, content.body);
  }
};

// =========================================================
// ADMIN NOTIFICATIONS
// =========================================================

const notifyAdminNewRefund = async (refund) => {
  if (!NOTIFICATIONS.admin.alertOnNewRefund) return;

  console.log(`[Admin Notification] New refund request pending: ${refund.refund_code}`);
  // TODO: Push notification to admin dashboard
  // Ví dụ: WebSocket, Push notification, Slack, etc.
};

const checkAndAlertSLABreach = async () => {
  if (!NOTIFICATIONS.admin.alertOnSLABreach) return;

  // TODO: Check refunds that have exceeded SLA
  // Gửi alert cho admin
  console.log('[Admin Notification] Checking SLA breaches...');
};

// =========================================================
// UTILITIES
// =========================================================

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
  }).format(amount || 0);
};

const formatDate = (dateString) => {
  if (!dateString) return 'N/A';
  return new Date(dateString).toLocaleString('vi-VN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  // Core functions
  createRefundNotification,
  createDateChangeNotification,
  createFlightCancellationNotification,

  // Admin functions
  notifyAdminNewRefund,
  checkAndAlertSLABreach,

  // Utilities
  sendEmail,
  formatCurrency,
  formatDate,
};
