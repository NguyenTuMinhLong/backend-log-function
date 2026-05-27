/**
 * ============================================================
 *  UNIT TEST — Membership / Loyalty Service
 *  Chạy: node --test tests/unit/membership.service.test.js
 * ============================================================
 *
 *  Test 3 hàm cốt lõi:
 *    1. resolveTier          (private → test gián tiếp qua getMembershipInfo)
 *    2. calcNextTierAndProgress (private → test gián tiếp)
 *    3. earnPointsAfterBooking (exported)
 *    4. revokePointsOnCancel   (exported)
 *
 *  Kỹ thuật: Manual Module Mock (inject cache) — không cần jest
 * ============================================================
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const SERVICE_PATH = path.resolve(__dirname, '../../src/services/loyalty.service.js');
const DB_PATH      = path.resolve(__dirname, '../../src/config/db.js');
const QUERIES_PATH = path.resolve(__dirname, '../../src/queries/loyalty.queries.js');

// ── Stub queries (các key mà service import) ─────────────────────────────
const STUB_QUERIES = {
  GET_USER_LOYALTY:          'STUB',
  GET_LOYALTY_TIER_BY_NAME:  'STUB',
  CREATE_USER_LOYALTY:       'STUB',
  INSERT_TRANSACTION:        'STUB',
  GET_LOYALTY_TIER:          'STUB',
};

// ── Helper: nạp lại loyalty.service với db.query giả ─────────────────────
function loadLoyaltyService(fakeQuery) {
  [SERVICE_PATH, DB_PATH, QUERIES_PATH].forEach(p => delete require.cache[p]);

  require.cache[DB_PATH] = {
    id: DB_PATH, filename: DB_PATH, loaded: true,
    exports: { query: fakeQuery },
  };

  require.cache[QUERIES_PATH] = {
    id: QUERIES_PATH, filename: QUERIES_PATH, loaded: true,
    exports: STUB_QUERIES,
  };

  return require(SERVICE_PATH);
}

// ── Dữ liệu membership mẫu ───────────────────────────────────────────────
function makeMembership(overrides = {}) {
  return {
    membership_number: 'VVD123456789',
    tier_name:     'Member',
    tier_points:   '0',
    current_points: '0',
    lifetime_points: '0',
    multiplier:    '1.0',
    benefits:      [],
    badge_url_light: null,
    badge_url_dark:  null,
    ...overrides,
  };
}

// ============================================================
// A. getMembershipInfo — tier và progress
// ============================================================

test('getMembershipInfo: tier Member khi có 0 điểm', async () => {
  const member = makeMembership({ tier_name: 'Member', tier_points: '0' });
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  assert.equal(result.tier, 'Member');
  assert.equal(result.tier_points, 0);
  assert.ok(result.next_tier !== null, 'Member chưa max tier, phải có next_tier');
  assert.equal(result.next_tier.name, 'Silver');
});

test('getMembershipInfo: tier Silver khi có 5000 điểm', async () => {
  const member = makeMembership({ tier_name: 'Silver', tier_points: '5000' });
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  assert.equal(result.tier, 'Silver');
  assert.equal(result.next_tier.name, 'Gold');
  // progress Silver→Gold: (5000-5000)/(20000-5000)*100 = 0
  assert.equal(result.progress, 0);
});

test('getMembershipInfo: tier Gold khi có 20000 điểm', async () => {
  const member = makeMembership({ tier_name: 'Gold', tier_points: '20000' });
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  assert.equal(result.tier, 'Gold');
  assert.equal(result.next_tier.name, 'Platinum');
});

test('getMembershipInfo: tier Platinum → progress = 100, next_tier = null', async () => {
  const member = makeMembership({ tier_name: 'Platinum', tier_points: '60000' });
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  assert.equal(result.tier, 'Platinum');
  assert.equal(result.progress, 100, 'Max tier phải progress = 100');
  assert.equal(result.next_tier, null, 'Max tier không có next_tier');
});

test('getMembershipInfo: progress đúng khi ở giữa tier Member và Silver', async () => {
  // Member(0) → Silver(5000): 2500 điểm = 50%
  const member = makeMembership({ tier_name: 'Member', tier_points: '2500' });
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  assert.equal(result.progress, 50, `progress phải = 50%, thực tế: ${result.progress}`);
});

test('getMembershipInfo: benefits trả về tiếng Việt theo mặc định', async () => {
  const member = makeMembership({ tier_name: 'Silver', tier_points: '5000' });
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  assert.ok(Array.isArray(result.benefits), 'benefits phải là array');
  assert.ok(result.benefits.length > 0, 'Silver phải có ít nhất 1 benefit');
  // Benefit tiếng Việt có chứa ký tự tiếng Việt hoặc 'x'
  assert.ok(result.benefits[0].includes('1.25x') || result.benefits[0].includes('điểm'),
    `Benefit không đúng ngôn ngữ: ${result.benefits[0]}`);
});

test('getMembershipInfo: trả đúng cấu trúc object', async () => {
  const member = makeMembership();
  const service = loadLoyaltyService(async () => ({ rows: [member] }));

  const result = await service.getMembershipInfo(1, 'vi');

  const requiredKeys = [
    'membership_number', 'tier', 'lifetime_points',
    'tier_points', 'current_points', 'multiplier',
    'next_tier', 'progress', 'benefits',
  ];
  requiredKeys.forEach(key => {
    assert.ok(key in result, `Thiếu trường "${key}" trong kết quả getMembershipInfo`);
  });
});

// ============================================================
// B. earnPointsAfterBooking — tích điểm sau booking
// ============================================================

test('earnPointsAfterBooking: tính đúng điểm với multiplier Member (x1.0)', async () => {
  // totalPrice = 500,000 → basePoints = 50 → x1.0 = 50
  let updateCalled = false;
  let insertCalled = false;
  let syncCalled   = false;
  let callCount    = 0;

  const fakeQuery = async (sql, params) => {
    callCount++;
    const s = typeof sql === 'string' ? sql : '';

    if (s.includes('SELECT lt.multiplier')) {
      return { rows: [{ multiplier: '1.0' }] };
    }
    if (s.includes('UPDATE user_loyalty')) {
      updateCalled = true;
      // Kiểm tra pointsEarned = floor(500000/10000 * 1.0) = 50
      assert.equal(params[0], 50, `pointsEarned phải = 50, thực tế: ${params[0]}`);
      return { rows: [] };
    }
    if (s.includes('INSERT_TRANSACTION') || s === STUB_QUERIES.INSERT_TRANSACTION) {
      insertCalled = true;
      return { rows: [] };
    }
    // syncTierAfterChange gọi SELECT
    syncCalled = true;
    return { rows: [{ tier_id: 1, tier_name: 'Member', min_points: 0, tier_points: 50, multiplier: '1.0' }] };
  };

  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 101, 500_000);

  assert.equal(result.pointsEarned, 50, 'Phải trả về pointsEarned = 50');
  assert.ok(updateCalled, 'Phải gọi UPDATE user_loyalty');
});

test('earnPointsAfterBooking: bỏ qua tích điểm nếu giá vé quá thấp (< 10,000 VNĐ)', async () => {
  const fakeQuery = async (sql) => {
    if (typeof sql === 'string' && sql.includes('SELECT lt.multiplier')) {
      return { rows: [{ multiplier: '1.0' }] };
    }
    return { rows: [] };
  };

  const service = loadLoyaltyService(fakeQuery);
  // totalPrice = 5,000 → basePoints = floor(5000/10000) = 0 → skip
  const result  = await service.earnPointsAfterBooking(1, 102, 5_000);

  assert.equal(result.pointsEarned, 0, 'Không tích điểm khi giá vé < 10,000 VNĐ');
});

test('earnPointsAfterBooking: nhân đúng multiplier Silver (x1.25)', async () => {
  // totalPrice = 1,000,000 → basePoints = 100 → x1.25 = 125
  let capturedPoints = null;

  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.25' }] };
    if (s.includes('UPDATE user_loyalty') && params && params[0] !== undefined) {
      capturedPoints = params[0]; // capture pointsEarned từ UPDATE
      return { rows: [] };
    }
    // sync tier: trả về Silver row
    return { rows: [{ tier_name: 'Silver', tier_points: 125, min_points: 5000, multiplier: '1.25', tier_id: 2 }] };
  };

  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 103, 1_000_000);

  assert.equal(result.pointsEarned, 125, 'pointsEarned phải = 125 với Silver x1.25');
  assert.equal(capturedPoints, 125, 'UPDATE phải trừ đúng 125 điểm');
});

// ============================================================
// C. revokePointsOnCancel — trừ điểm khi huỷ
// ============================================================

test('revokePointsOnCancel: trả về pointsRevoked = 0 nếu booking chưa tích điểm', async () => {
  // Không có earn transaction → bỏ qua
  const fakeQuery = async () => ({ rows: [] });
  const service   = loadLoyaltyService(fakeQuery);

  const result = await service.revokePointsOnCancel(1, 999);

  assert.equal(result.pointsRevoked, 0, 'Không có điểm để revoke → 0');
});

test('revokePointsOnCancel: trừ đúng số điểm đã earn', async () => {
  let updateParams = null;
  let callIdx = 0;

  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    callIdx++;

    // Query 1: tìm earn transaction
    if (s.includes('loyalty_transactions') && s.includes("type       = 'earn'")) {
      return { rows: [{ amount: '100' }] };
    }
    // Query 2: lấy điểm hiện tại
    if (s.includes('SELECT tier_points, current_points')) {
      return { rows: [{ tier_points: '200', current_points: '150' }] };
    }
    // Query 3: UPDATE trừ điểm
    if (s.includes('UPDATE user_loyalty')) {
      updateParams = params;
      return { rows: [] };
    }
    // Query 4+: sync tier + insert transaction
    return { rows: [{ tier_name: 'Member', tier_points: 100, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };

  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.revokePointsOnCancel(1, 101);

  assert.equal(result.pointsRevoked, 100, 'Phải revoke đúng 100 điểm');
  assert.ok(updateParams !== null, 'Phải gọi UPDATE user_loyalty');
  // params[0] = safeRevokeTier = min(100, 200) = 100
  assert.equal(updateParams[0], 100, 'safeRevokeTier phải = 100');
});

test('revokePointsOnCancel: không để điểm âm — chỉ trừ tối đa xuống 0', async () => {
  let updateParams = null;

  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('loyalty_transactions') && s.includes("type       = 'earn'")) {
      return { rows: [{ amount: '500' }] }; // muốn trừ 500
    }
    if (s.includes('SELECT tier_points, current_points')) {
      return { rows: [{ tier_points: '200', current_points: '80' }] }; // chỉ có 200/80
    }
    if (s.includes('UPDATE user_loyalty')) {
      updateParams = params;
      return { rows: [] };
    }
    return { rows: [{ tier_name: 'Member', tier_points: 0, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };

  const service = loadLoyaltyService(fakeQuery);
  await service.revokePointsOnCancel(1, 101);

  // safeRevokeTier = min(500, 200) = 200
  // safeRevokeCurrent = min(500, 80) = 80
  assert.equal(updateParams[0], 200, 'safeRevokeTier = min(500, 200) = 200');
  assert.equal(updateParams[1], 80,  'safeRevokeCurrent = min(500, 80) = 80');
});
