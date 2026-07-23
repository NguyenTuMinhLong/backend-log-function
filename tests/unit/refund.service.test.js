'use strict';

const mockClient = {
  query: jest.fn(),
  release: jest.fn(),
};
jest.mock('../../src/config/db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

// Mock queries
jest.mock('../../src/queries/refund.queries', () => ({
  SELECT_REFUND_BY_CODE: 'SELECT_REFUND_BY_CODE',
  CHECK_PENDING_REFUND_FOR_BOOKING: 'CHECK_PENDING_REFUND_FOR_BOOKING',
  CHECK_REFUND_EXISTS_BY_CODE: 'CHECK_REFUND_EXISTS_BY_CODE',
  INSERT_REFUND: 'INSERT_REFUND',
  UPDATE_REFUND_STATUS: 'UPDATE_REFUND_STATUS',
  UPDATE_REFUND_COMPLETED: 'UPDATE_REFUND_COMPLETED',
  COUNT_GUEST_REFUNDS_FOR_LINK: 'COUNT_GUEST_REFUNDS_FOR_LINK',
  LINK_GUEST_REFUNDS_TO_USER: 'LINK_GUEST_REFUNDS_TO_USER',
  SELECT_GUEST_REFUNDS_BY_SESSION: 'SELECT_GUEST_REFUNDS_BY_SESSION',
  SELECT_GUEST_REFUNDS_BY_EMAIL: 'SELECT_GUEST_REFUNDS_BY_EMAIL',
  SELECT_REFUNDS_BY_BOOKING: 'SELECT_REFUNDS_BY_BOOKING',
  SELECT_USER_REFUNDS: 'SELECT_USER_REFUNDS',
  COUNT_USER_REFUNDS: 'COUNT_USER_REFUNDS',
}));

jest.mock('../../src/queries/booking.queries', () => ({
  SELECT_BOOKING_DETAIL: 'SELECT_BOOKING_DETAIL',
  UPDATE_BOOKING_STATUS: 'UPDATE_BOOKING_STATUS',
}));

jest.mock('../../src/queries/payment.queries', () => ({
  SELECT_PAYMENT_BY_BOOKING: 'SELECT_PAYMENT_BY_BOOKING',
}));

// Mock external services
jest.mock('../../src/services/loyalty.service', () => ({
  revokePointsForRefund: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/services/notification.service', () => ({
  createRefundNotification: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/utils/mailer', () => ({
  sendRefundOTPEmail: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../src/providers/paypal.provider', () => ({
  refundPayPalCapture: jest.fn().mockResolvedValue({ id: 'paypal-refund-id' }),
}));

jest.mock('../../src/providers/payos.provider', () => ({
  getPayosClient: jest.fn().mockReturnValue({}),
}));

jest.mock('../../src/config/payment.config', () => ({
  paypal: { currency: 'VND' },
  payos: { enabled: false },
}));

// Mock refund config
jest.mock('../../src/config/refund.config', () => ({
  POLICIES: [
    { name: 'early', label: 'Sớm', hoursBefore: 24, refundPercent: 90 },
    { name: 'late', label: 'Trễ', hoursBefore: 2, refundPercent: 50 },
    { name: 'no_refund', label: 'Không hoàn', hoursBefore: 0, refundPercent: 0 },
  ],
  ADMIN_FEE: {
    enabled: true,
    percent: 5,
    minAmount: 50000,
    maxAmount: 500000,
    exemptStatuses: [],
  },
  VOUCHER_HANDLING: {
    refundOnFinalAmount: true,
  },
  VALIDATION: {
    requireReason: true,
    minReasonLength: 10,
    minRefundAmount: 10000,
  },
  CONCURRENCY: {
    preventDuplicateRequests: true,
  },
  OTP_CONFIG: {
    enabled: true,
    threshold: 5000000,    // 5tr → OTP bắt buộc
    codeLength: 6,
    expiresInMinutes: 10,
    maxAttempts: 5,
    resendCooldownMinutes: 1,
  },
  findPolicy: jest.fn(),
  hoursBeforeDeparture: jest.fn(),
}));

// IMPORT SERVICE (sau khi mock xong)


const pool = require('../../src/config/db');
const { findPolicy } = require('../../src/config/refund.config');
const { createRefundNotification } = require('../../src/services/notification.service');
const {
  requestRefund,
  requestGuestRefund,
} = require('../../src/services/refund.service');

// TEST DATA FACTORIES

const futureDate = (hoursFromNow = 48) => {
  const d = new Date();
  d.setHours(d.getHours() + hoursFromNow);
  return d.toISOString();
};

const makeBooking = (overrides = {}) => ({
  id: 1,
  booking_code: 'BK-TEST-001',
  user_id: 42,
  status: 'confirmed',
  trip_type: 'one_way',
  outbound_departure_time: futureDate(48),
  return_departure_time: null,
  outbound_flight_id: 10,
  return_flight_id: null,
  outbound_seat_class: 'economy',
  return_seat_class: null,
  total_adults: 1,
  total_children: 0,
  total_infants: 0,
  contact_email: 'user@test.com',
  guest_email: null,
  ...overrides,
});

const makePayment = (overrides = {}) => ({
  id: 99,
  booking_id: 1,
  status: 'SUCCESS',
  amount: '2000000',
  final_amount: '2000000',
  discount_amount: '0',
  gateway_response: { provider: 'BANK_QR' },
  ...overrides,
});

const makeRefundRow = (overrides = {}) => ({
  id: 1,
  refund_code: 'REF-20240101-ABCDEF',
  booking_id: 1,
  status: 'pending',
  refund_type: 'full',
  refund_amount: 1800000,
  admin_fee: 90000,
  net_refund_amount: 1710000,
  requested_by: 42,
  is_guest: false,
  guest_email: null,
  payment_id: 99,
  ...overrides,
});

const validData = {
  refund_type: 'full',
  reason: 'Tôi muốn hủy chuyến bay vì kế hoạch thay đổi',
  user_notes: null,
};

// Policy mock hay dùng
const earlyPolicy = { name: 'early', label: 'Sớm', hoursBefore: 24, refundPercent: 90 };
const noRefundPolicy = { name: 'no_refund', label: 'Không hoàn', hoursBefore: 0, refundPercent: 0 };
// HELPERS
/**
 * Setup mock client.query theo thứ tự call
 * Mỗi phần tử trong `sequence` là return value của 1 lần query()
 */
const setupClientQuerySequence = (...responses) => {
  let callIndex = 0;
  mockClient.query.mockImplementation(() => {
    const res = responses[callIndex] ?? { rows: [], rowCount: 0 };
    callIndex++;
    return Promise.resolve(res);
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  pool.connect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
  findPolicy.mockReturnValue(earlyPolicy);
});

// requestRefund - TESTS

describe('requestRefund', () => {
  // ----- VALIDATION -----
  describe('Input validation', () => {
    it('throws nếu reason thiếu', async () => {
      await expect(
        requestRefund(42, 'BK-001', { ...validData, reason: '' })
      ).rejects.toThrow('Lý do yêu cầu refund phải có ít nhất');
    });

    it('throws nếu reason quá ngắn (< 10 ký tự)', async () => {
      await expect(
        requestRefund(42, 'BK-001', { ...validData, reason: 'Ngắn' })
      ).rejects.toThrow('Lý do yêu cầu refund phải có ít nhất');
    });

    it('throws nếu refund_type không hợp lệ', async () => {
      await expect(
        requestRefund(42, 'BK-001', { ...validData, refund_type: 'unknown_type' })
      ).rejects.toThrow('refund_type phải là:');
    });
  });

  // ----- BOOKING LOOKUP -----
  describe('Booking lookup', () => {
    it('throws nếu booking không tồn tại', async () => {
      setupClientQuerySequence(
        { rows: [] }, // BEGIN
        { rows: [] }, // SELECT_BOOKING_DETAIL → empty
      );

      await expect(
        requestRefund(42, 'BK-NOT-FOUND', validData)
      ).rejects.toThrow('Không tìm thấy booking');
    });

    it('throws nếu user không phải owner của booking', async () => {
      setupClientQuerySequence(
        { rows: [] },                              // BEGIN
        { rows: [makeBooking({ user_id: 99 })] }, // booking của user 99
      );

      await expect(
        requestRefund(42, 'BK-001', validData) // request bằng userId=42
      ).rejects.toThrow('Bạn không có quyền');
    });
  });

  // ----- BOOKING VALIDATION -----
  describe('Booking status & flight validation', () => {
    it('throws nếu booking chưa thanh toán (status != confirmed)', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking({ status: 'pending' })] },
        { rows: [makePayment()] },
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Không thể refund booking có trạng thái'
      );
    });

    it('throws nếu chuyến bay đã khởi hành', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking({ outbound_departure_time: new Date(Date.now() - 1000).toISOString() })] },
        { rows: [makePayment()] },
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Chuyến bay đã khởi hành'
      );
    });

    it('throws nếu payment không tồn tại', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking()] },
        { rows: [] }, // payment empty
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Không tìm thấy thông tin thanh toán'
      );
    });

    it('throws nếu payment chưa success', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking()] },
        { rows: [makePayment({ status: 'PENDING' })] },
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Chỉ booking đã thanh toán thành công'
      );
    });
  });

  // ----- BUSINESS RULES -----
  describe('Business rules', () => {
    it('throws nếu đã có refund request đang pending', async () => {
      setupClientQuerySequence(
        { rows: [] },                         // BEGIN
        { rows: [makeBooking()] },            // booking
        { rows: [makePayment()] },            // payment
        { rows: [{ id: 5 }] },               // existing pending refund → found
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Đã có yêu cầu refund đang chờ xử lý'
      );
    });

    it('throws nếu policy không cho phép refund (sát giờ bay)', async () => {
      findPolicy.mockReturnValue(noRefundPolicy);

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking()] },
        { rows: [makePayment()] },
        { rows: [] }, // no pending refund
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Không thể refund'
      );
    });

    it('throws nếu OTP chưa verify cho hóa đơn lớn (≥ 5tr)', async () => {
      // Payment lớn hơn threshold → OTP required
      const bigPayment = makePayment({ amount: '6000000', final_amount: '6000000' });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking()] },
        { rows: [bigPayment] },
        { rows: [] }, // no pending refund
      );

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow(
        'Yêu cầu xác thực OTP'
      );
    });
  });

  // ----- SUCCESS PATH -----
  describe('Happy path', () => {
    it('tạo refund thành công với booking hợp lệ', async () => {
      const refundRow = makeRefundRow();

      setupClientQuerySequence(
        { rows: [] },                  // BEGIN
        { rows: [makeBooking()] },     // booking
        { rows: [makePayment()] },     // payment
        { rows: [] },                  // no pending refund
        { rows: [] },                  // CHECK_REFUND_EXISTS_BY_CODE → code unique
        { rows: [refundRow] },         // INSERT_REFUND
        { rows: [] },                  // UPDATE_BOOKING_STATUS
        { rows: [] },                  // COMMIT
      );

      const result = await requestRefund(42, 'BK-001', validData);

      expect(result.success).toBe(true);
      expect(result.refund_code).toBe(refundRow.refund_code);
      expect(result.status).toBe('pending');
      expect(result.refund_preview).toBeDefined();
      expect(result.refund_preview.refund_amount).toBeGreaterThan(0);
    });

    it('rollback khi có lỗi phát sinh trong transaction', async () => {
      setupClientQuerySequence(
        { rows: [] },                           // BEGIN
        { rows: [makeBooking()] },              // booking
        { rows: [makePayment()] },              // payment
        { rows: [] },                           // no pending refund
        { rows: [] },                           // code unique
      );
      // INSERT_REFUND ném lỗi
      mockClient.query.mockRejectedValueOnce(new Error('DB insert error'));

      await expect(requestRefund(42, 'BK-001', validData)).rejects.toThrow('DB insert error');

      const calls = mockClient.query.mock.calls.map(c => c[0]);
      expect(calls).toContain('ROLLBACK');
    });

    it('notification lỗi không làm fail toàn bộ refund', async () => {
      createRefundNotification.mockRejectedValueOnce(new Error('Email server down'));
      const refundRow = makeRefundRow();

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking()] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
        { rows: [refundRow] },
        { rows: [] }, // UPDATE_BOOKING_STATUS
        { rows: [] }, // COMMIT
      );

      const result = await requestRefund(42, 'BK-001', validData);
      expect(result.success).toBe(true); // vẫn thành công
    });

    it('hỗ trợ partial_passenger refund type', async () => {
      const refundRow = makeRefundRow({ refund_type: 'partial_passenger' });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeBooking({ total_adults: 2 })] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
        { rows: [refundRow] },
        { rows: [] },
        { rows: [] },
      );

      const result = await requestRefund(42, 'BK-001', {
        ...validData,
        refund_type: 'partial_passenger',
        requested_items: { passenger_ids: [1] },
      });

      expect(result.success).toBe(true);
      expect(result.refund_type).toBe('partial_passenger');
    });
  });
});

// requestGuestRefund - TESTS


describe('requestGuestRefund', () => {
  const GUEST_EMAIL = 'guest@test.com';

  const makeGuestBooking = (overrides = {}) =>
    makeBooking({
      user_id: null,
      contact_email: GUEST_EMAIL,
      guest_email: GUEST_EMAIL,
      ...overrides,
    });

  // ----- INPUT VALIDATION -----
  describe('Input validation', () => {
    it('throws nếu reason thiếu', async () => {
      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, { ...validData, reason: '' })
      ).rejects.toThrow('Lý do yêu cầu refund phải có ít nhất');
    });

    it('throws nếu refund_type không hợp lệ', async () => {
      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, { ...validData, refund_type: 'invalid' })
      ).rejects.toThrow('refund_type phải là:');
    });

    it('throws nếu guestEmail không có @', async () => {
      await expect(
        requestGuestRefund('BK-001', 'not-an-email', validData)
      ).rejects.toThrow('Email xác thực không hợp lệ');
    });

    it('throws nếu guestEmail là null/undefined', async () => {
      await expect(
        requestGuestRefund('BK-001', null, validData)
      ).rejects.toThrow('Email xác thực không hợp lệ');
    });
  });

  // ----- EMAIL VERIFICATION -----
  describe('Guest email verification', () => {
    it('throws nếu email không khớp với booking', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking({ contact_email: 'other@test.com', guest_email: 'other@test.com' })] },
      );

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('Email xác thực không khớp');
    });

    it('chấp nhận match qua contact_email (không cần guest_email)', async () => {
      // guest_email null nhưng contact_email match
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking({ guest_email: null, contact_email: GUEST_EMAIL })] },
        { rows: [makePayment()] },
        { rows: [] }, // no pending refund
        { rows: [] }, // code unique
        { rows: [makeRefundRow({ is_guest: true, guest_email: GUEST_EMAIL })] },
        { rows: [] }, // UPDATE_BOOKING_STATUS
        { rows: [] }, // COMMIT
      );

      const result = await requestGuestRefund('BK-001', GUEST_EMAIL, validData);
      expect(result.success).toBe(true);
    });

    it('case-insensitive email match', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking({ contact_email: 'GUEST@TEST.COM', guest_email: 'GUEST@TEST.COM' })] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
        { rows: [makeRefundRow({ is_guest: true })] },
        { rows: [] },
        { rows: [] },
      );

      const result = await requestGuestRefund('BK-001', 'guest@test.com', validData);
      expect(result.success).toBe(true);
    });
  });

  // ----- BOOKING/PAYMENT VALIDATION -----
  describe('Booking & Payment validation', () => {
    it('throws nếu booking không tồn tại', async () => {
      setupClientQuerySequence(
        { rows: [] }, // BEGIN
        { rows: [] }, // booking not found
      );

      await expect(
        requestGuestRefund('BK-NOT-FOUND', GUEST_EMAIL, validData)
      ).rejects.toThrow('Không tìm thấy booking');
    });

    it('throws nếu payment không tồn tại', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [] }, // payment not found
      );

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('Không tìm thấy thông tin thanh toán');
    });

    it('throws nếu booking không phải confirmed', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking({ status: 'refunded' })] },
        { rows: [makePayment()] },
      );

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('Không thể refund booking có trạng thái');
    });
  });

  // ----- BUSINESS RULES -----
  describe('Business rules', () => {
    it('throws nếu đã có pending refund', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [{ id: 5 }] }, // existing pending refund
      );

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('Đã có yêu cầu refund đang chờ xử lý');
    });

    it('throws nếu policy refundPercent = 0', async () => {
      findPolicy.mockReturnValue(noRefundPolicy);

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [] },
      );

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('Không thể refund');
    });

    it('throws nếu hóa đơn lớn và OTP chưa verify', async () => {
      const bigPayment = makePayment({ amount: '8000000', final_amount: '8000000' });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [bigPayment] },
        { rows: [] },
      );

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('Yêu cầu xác thực OTP');
    });
  });

  // ----- SUCCESS PATH -----
  describe('Happy path', () => {
    it('tạo guest refund thành công', async () => {
      const refundRow = makeRefundRow({ is_guest: true, guest_email: GUEST_EMAIL });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [] }, // no pending refund
        { rows: [] }, // code unique
        { rows: [refundRow] },
        { rows: [] }, // UPDATE_BOOKING_STATUS
        { rows: [] }, // COMMIT
      );

      const result = await requestGuestRefund('BK-001', GUEST_EMAIL, validData);

      expect(result.success).toBe(true);
      expect(result.refund_code).toBe(refundRow.refund_code);
      expect(result.status).toBe('pending');
      expect(result.otp_verified).toBeDefined();
    });

    it('lưu is_guest=true vào DB', async () => {
      const refundRow = makeRefundRow({ is_guest: true, guest_email: GUEST_EMAIL });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
        { rows: [refundRow] },
        { rows: [] },
        { rows: [] },
      );

      await requestGuestRefund('BK-001', GUEST_EMAIL, validData);

      // Tìm call INSERT_REFUND và kiểm tra is_guest param
      const insertCall = mockClient.query.mock.calls.find(
        ([sql]) => sql === 'INSERT_REFUND'
      );
      expect(insertCall).toBeDefined();
      // is_guest = true là param thứ 13 (index 12)
      expect(insertCall[1][12]).toBe(true);
      // guest_email là param thứ 14 (index 13)
      expect(insertCall[1][13]).toBe(GUEST_EMAIL.toLowerCase());
    });

    it('lưu guestSessionId nếu có', async () => {
      const refundRow = makeRefundRow({ is_guest: true, guest_email: GUEST_EMAIL });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
        { rows: [refundRow] },
        { rows: [] },
        { rows: [] },
      );

      await requestGuestRefund('BK-001', GUEST_EMAIL, validData, { guestSessionId: 'sess-abc-123' });

      const insertCall = mockClient.query.mock.calls.find(
        ([sql]) => sql === 'INSERT_REFUND'
      );
      expect(insertCall[1][14]).toBe('sess-abc-123');
    });

    it('rollback khi DB lỗi trong transaction', async () => {
      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
      );
      mockClient.query.mockRejectedValueOnce(new Error('DB error'));

      await expect(
        requestGuestRefund('BK-001', GUEST_EMAIL, validData)
      ).rejects.toThrow('DB error');

      const calls = mockClient.query.mock.calls.map(c => c[0]);
      expect(calls).toContain('ROLLBACK');
    });

    it('notification lỗi không làm fail refund', async () => {
      createRefundNotification.mockRejectedValueOnce(new Error('Notif fail'));
      const refundRow = makeRefundRow({ is_guest: true });

      setupClientQuerySequence(
        { rows: [] },
        { rows: [makeGuestBooking()] },
        { rows: [makePayment()] },
        { rows: [] },
        { rows: [] },
        { rows: [refundRow] },
        { rows: [] },
        { rows: [] },
      );

      const result = await requestGuestRefund('BK-001', GUEST_EMAIL, validData);
      expect(result.success).toBe(true);
    });
  });
});