const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const servicePath = path.resolve(__dirname, "../../src/services/refund.service.js");
const dbPath = path.resolve(__dirname, "../../src/config/db.js");
const qrPath = path.resolve(__dirname, "../../src/queries/refund.queries.js");
const qbPath = path.resolve(__dirname, "../../src/queries/booking.queries.js");
const qpPath = path.resolve(__dirname, "../../src/queries/payment.queries.js");
const refundConfigPath = path.resolve(__dirname, "../../src/config/refund.config.js");
const loyaltyPath = path.resolve(__dirname, "../../src/services/loyalty.service.js");
const notifPath = path.resolve(__dirname, "../../src/services/notification.service.js");
const mailerPath = path.resolve(__dirname, "../../src/utils/mailer.js");
const paypalPath = path.resolve(__dirname, "../../src/providers/paypal.provider.js");
const payosPath = path.resolve(__dirname, "../../src/providers/payos.provider.js");
const paymentConfigPath = path.resolve(__dirname, "../../src/config/payment.config.js");

function loadRefundService(clientQueryImpl) {
  delete require.cache[servicePath];
  delete require.cache[dbPath];
  delete require.cache[qrPath];
  delete require.cache[qbPath];
  delete require.cache[qpPath];
  delete require.cache[refundConfigPath];
  delete require.cache[loyaltyPath];
  delete require.cache[notifPath];
  delete require.cache[mailerPath];
  delete require.cache[paypalPath];
  delete require.cache[payosPath];
  delete require.cache[paymentConfigPath];

  const mockClient = {
    query: clientQueryImpl,
    release: () => {},
  };

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      connect: async () => mockClient,
      query: async () => ({ rows: [] }),
    },
  };

  require.cache[qrPath] = {
    id: qrPath,
    filename: qrPath,
    loaded: true,
    exports: {
      CHECK_PENDING_REFUND_FOR_BOOKING: "CHECK_PENDING_REFUND_FOR_BOOKING",
      CHECK_REFUND_EXISTS_BY_CODE: "CHECK_REFUND_EXISTS_BY_CODE",
      INSERT_REFUND: "INSERT_REFUND",
    },
  };

  require.cache[qbPath] = {
    id: qbPath,
    filename: qbPath,
    loaded: true,
    exports: {
      SELECT_BOOKING_DETAIL: "SELECT_BOOKING_DETAIL",
      UPDATE_BOOKING_STATUS: "UPDATE_BOOKING_STATUS",
    },
  };

  require.cache[qpPath] = {
    id: qpPath,
    filename: qpPath,
    loaded: true,
    exports: {
      SELECT_PAYMENT_BY_BOOKING: "SELECT_PAYMENT_BY_BOOKING",
    },
  };

  require.cache[refundConfigPath] = {
    id: refundConfigPath,
    filename: refundConfigPath,
    loaded: true,
    exports: {
      POLICIES: [{ name: "early", label: "Som", hoursBefore: 24, refundPercent: 90 }],
      ADMIN_FEE: { enabled: true, percent: 5, minAmount: 50000, maxAmount: 500000, exemptStatuses: [] },
      VOUCHER_HANDLING: { refundOnFinalAmount: true },
      VALIDATION: { requireReason: true, minReasonLength: 10, minRefundAmount: 10000 },
      CONCURRENCY: { preventDuplicateRequests: true },
      OTP_CONFIG: { enabled: true, threshold: 5000000, codeLength: 6, expiresInMinutes: 10, maxAttempts: 5, resendCooldownMinutes: 1 },
      findPolicy: () => ({ name: "early", label: "Som", hoursBefore: 24, refundPercent: 90 }),
      hoursBeforeDeparture: () => 48,
    },
  };

  require.cache[loyaltyPath] = { id: loyaltyPath, filename: loyaltyPath, loaded: true, exports: { revokePointsForRefund: async () => true } };
  require.cache[notifPath] = { id: notifPath, filename: notifPath, loaded: true, exports: { createRefundNotification: async () => true } };
  require.cache[mailerPath] = { id: mailerPath, filename: mailerPath, loaded: true, exports: { sendRefundOTPEmail: async () => true } };
  require.cache[paypalPath] = { id: paypalPath, filename: paypalPath, loaded: true, exports: { refundPayPalCapture: async () => ({ id: "refund" }) } };
  require.cache[payosPath] = { id: payosPath, filename: payosPath, loaded: true, exports: { getPayosClient: () => ({}) } };
  require.cache[paymentConfigPath] = { id: paymentConfigPath, filename: paymentConfigPath, loaded: true, exports: { paypal: { currency: "VND" }, payos: { enabled: false } } };

  return require(servicePath);
}

function makeBooking(overrides = {}) {
  const future = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  return {
    id: 1,
    user_id: 42,
    status: "confirmed",
    trip_type: "one_way",
    outbound_departure_time: future,
    contact_email: "user@test.com",
    ...overrides,
  };
}

function makePayment(overrides = {}) {
  return {
    id: 10,
    booking_id: 1,
    status: "SUCCESS",
    amount: "2000000",
    final_amount: "2000000",
    discount_amount: "0",
    ...overrides,
  };
}

test("requestRefund: báo lỗi khi reason quá ngắn", async () => {
  const svc = loadRefundService(async () => ({ rows: [] }));
  await assert.rejects(
    () => svc.requestRefund(42, "BK001", { refund_type: "full", reason: "ngan" }),
    /Lý do yêu cầu refund phải có ít nhất/
  );
});

test("requestRefund: báo lỗi khi booking không tồn tại", async () => {
  let call = 0;
  const svc = loadRefundService(async () => {
    call += 1;
    if (call === 1) return { rows: [] }; // BEGIN
    if (call === 2) return { rows: [] }; // SELECT_BOOKING_DETAIL
    return { rows: [] };
  });

  await assert.rejects(
    () => svc.requestRefund(42, "BK-NOT-FOUND", { refund_type: "full", reason: "Ly do nay du dai hon 10 ky tu" }),
    /Không tìm thấy booking/
  );
});

test("requestGuestRefund: báo lỗi email xác thực không hợp lệ", async () => {
  const svc = loadRefundService(async () => ({ rows: [] }));
  await assert.rejects(
    () => svc.requestGuestRefund("BK001", "invalid-email", { refund_type: "full", reason: "Ly do nay du dai hon 10 ky tu" }),
    /Email xác thực không hợp lệ/
  );
});

test("requestRefund: tạo refund thành công với dữ liệu hợp lệ", async () => {
  let call = 0;
  const refundRow = { refund_code: "REF-20260101-ABC123", status: "pending" };

  const svc = loadRefundService(async (sql) => {
    call += 1;
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return { rows: [] };
    if (sql === "SELECT_BOOKING_DETAIL") return { rows: [makeBooking()] };
    if (sql === "SELECT_PAYMENT_BY_BOOKING") return { rows: [makePayment()] };
    if (sql === "CHECK_PENDING_REFUND_FOR_BOOKING") return { rows: [] };
    if (sql === "CHECK_REFUND_EXISTS_BY_CODE") return { rows: [] };
    if (sql === "INSERT_REFUND") return { rows: [refundRow] };
    if (sql === "UPDATE_BOOKING_STATUS") return { rows: [] };
    return { rows: [] };
  });

  const result = await svc.requestRefund(42, "BK001", {
    refund_type: "full",
    reason: "Ly do nay du dai hon 10 ky tu",
  });

  assert.equal(result.success, true);
  assert.equal(result.refund_code, refundRow.refund_code);
  assert.equal(result.status, "pending");
  assert.ok(call > 0);
});
