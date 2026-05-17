'use strict';

/*
=========================================================
REFUND CONFIGURATION
=========================================================

Time-based refund policies với percentage:
  - > 72 tiếng trước giờ bay: Hoàn 100%
  - 24-72 tiếng: Hoàn 80%
  - 12-24 tiếng: Hoàn 50%
  - < 12 tiếng: Không hoàn

Extensible: Thêm policy mới dễ dàng trong mảng POLICIES
=========================================================
*/

// Time-based refund policies (tính theo giờ trước khi khởi hành)
const POLICIES = [
  {
    name: 'full_refund',
    hoursBefore: 72,
    refundPercent: 100,
    label: 'Hoàn 100% - Yêu cầu trước 72 tiếng',
    priority: 1, // Policy ưu tiên thấp nhất (kiểm tra cuối)
  },
  {
    name: 'high_refund',
    hoursBefore: 24,
    refundPercent: 80,
    label: 'Hoàn 80% - Yêu cầu trong 24-72 tiếng',
    priority: 2,
  },
  {
    name: 'medium_refund',
    hoursBefore: 12,
    refundPercent: 50,
    label: 'Hoàn 50% - Yêu cầu trong 12-24 tiếng',
    priority: 3,
  },
  {
    name: 'low_refund',
    hoursBefore: 0,
    refundPercent: 0,
    label: 'Không hoàn - Yêu cầu dưới 12 tiếng',
    priority: 4,
  },
];

// Refund type labels
const REFUND_TYPES = {
  full: {
    label: 'Hoàn toàn bộ',
    description: 'Hoàn tiền toàn bộ booking',
  },
  partial_leg: {
    label: 'Hoàn 1 phần (theo chuyến)',
    description: 'Hoàn tiền cho 1 leg (chuyến đi hoặc chuyến về)',
  },
  partial_passenger: {
    label: 'Hoàn 1 phần (theo hành khách)',
    description: 'Hoàn tiền cho 1 số hành khách',
  },
};

// Refund status labels
const REFUND_STATUSES = {
  pending: {
    label: 'Chờ xử lý',
    color: 'warning',
    nextActions: ['approve', 'reject'],
  },
  approved: {
    label: 'Đã duyệt',
    color: 'info',
    nextActions: ['complete', 'cancel'],
  },
  rejected: {
    label: 'Từ chối',
    color: 'danger',
    nextActions: [],
  },
  processing: {
    label: 'Đang xử lý hoàn tiền',
    color: 'info',
    nextActions: ['complete', 'fail'],
  },
  completed: {
    label: 'Hoàn tiền thành công',
    color: 'success',
    nextActions: [],
  },
  cancelled: {
    label: 'Đã hủy yêu cầu',
    color: 'secondary',
    nextActions: [],
  },
  failed: {
    label: 'Hoàn tiền thất bại',
    color: 'danger',
    nextActions: ['retry', 'cancel'],
  },
};

// Admin fee settings
const ADMIN_FEE = {
  enabled: true,
  percent: 0, // 0% admin fee
  minAmount: 0,
  maxAmount: 0,
  exemptStatuses: ['full_refund'], // Miễn phí cho full refund
};

// SLA Configuration (Service Level Agreement)
const SLA = {
  maxProcessingDays: 7, // Tối đa 7 ngày xử lý refund
  escalationThresholdHours: 48, // Escalate sau 48 tiếng chưa xử lý
  autoRejectAfterDays: 30, // Tự động reject sau 30 ngày (nếu user không gửi docs)
  autoCompleteOnApproval: false, // Tự động complete sau khi approve
};

// Date Change Configuration
const DATE_CHANGE = {
  enabled: true,
  minHoursBeforeFlight: 24, // Không cho đổi nếu còn < 24 tiếng
  maxDateRange: 365, // Không cho đổi sang ngày cách > 365 ngày

  // Price difference handling
  priceDifference: {
    chargeIfPositive: true, // User phải trả thêm nếu price diff > 0
    refundIfNegative: true, // Hoàn tiền nếu price diff < 0
    requirePayment: false, // Có cần thanh toán trước khi approve không
  },

  // Seat availability check
  checkSeatAvailability: true, // Kiểm tra ghế còn trước khi tạo request
};

// Notification Settings
const NOTIFICATIONS = {
  // Email notifications
  email: {
    enabled: true,
    from: 'noreply@airlines.example.com',
    fromName: 'Airline Booking System',

    // Events to send
    sendRefundRequestedConfirmation: true,
    sendAdminNewRefundAlert: true,
    sendRefundApprovedNotification: true,
    sendRefundRejectedNotification: true,
    sendRefundCompletedNotification: true,
    sendRefundFailedNotification: true,

    // Date change
    sendDateChangeRequestedConfirmation: true,
    sendDateChangeApprovedNotification: true,
    sendDateChangeRejectedNotification: true,

    // Airline cancellation
    sendFlightCancelledNotifications: true,
  },

  // Admin dashboard notification
  admin: {
    alertOnNewRefund: true,
    alertOnSLABreach: true,
    dailyRefundReport: false,
  },
};

// Race condition protection
const CONCURRENCY = {
  preventDuplicateRequests: true,
  lockTimeoutMs: 5000, // Lock timeout 5 giây
};

// Voucher/Promotion impact on refund
const VOUCHER_HANDLING = {
  // refund trên số tiền ĐÃ TRẢ (final_amount) hay trên tổng (total_price)
  // true = refund trên final_amount (đã trừ voucher)
  // false = refund trên total_price (chưa trừ voucher)
  refundOnFinalAmount: true,
};

// Validation rules
const VALIDATION = {
  minRefundAmount: 0, // Số tiền hoàn tối thiểu
  maxRefundPercentOfOriginal: 100, // Không hoàn quá 100% số đã trả
  requireReason: true, // Bắt buộc nhập lý do
  minReasonLength: 10, // Lý do tối thiểu 10 ký tự
};

// Helper: Tìm policy phù hợp dựa trên giờ trước departure
const findPolicy = (hoursBeforeDeparture) => {
  // Sort theo priority giảm dần (kiểm tra policy có hoursBefore cao nhất trước)
  const sortedPolicies = [...POLICIES].sort((a, b) => b.hoursBefore - a.hoursBefore);

  for (const policy of sortedPolicies) {
    if (hoursBeforeDeparture >= policy.hoursBefore) {
      return policy;
    }
  }

  // Fallback: Trả về policy cuối cùng (low_refund với 0%)
  return sortedPolicies[sortedPolicies.length - 1];
};

// Helper: Tính số giờ trước departure
const hoursBeforeDeparture = (departureTime) => {
  const now = new Date();
  const departure = new Date(departureTime);
  const diffMs = departure - now;
  return diffMs > 0 ? diffMs / (1000 * 60 * 60) : 0;
};

module.exports = {
  // Policies
  POLICIES,
  REFUND_TYPES,
  REFUND_STATUSES,

  // Fees
  ADMIN_FEE,

  // SLA
  SLA,

  // Date Change
  DATE_CHANGE,

  // Notifications
  NOTIFICATIONS,

  // Concurrency
  CONCURRENCY,

  // Voucher
  VOUCHER_HANDLING,

  // Validation
  VALIDATION,

  // Helpers
  findPolicy,
  hoursBeforeDeparture,
};
