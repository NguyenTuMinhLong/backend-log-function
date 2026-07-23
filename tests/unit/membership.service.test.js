/**
 * ============================================================
 *  UNIT TEST — Membership / Loyalty Service
 *  Chạy: node --test tests/unit/membership.service.test.js
 *
 *  Mỗi TC có 2 luồng:
 *    ✅ Happy path  — input hợp lệ → kết quả đúng
 *    ❌ Failure path — input sai / edge case → expect lỗi hoặc giá trị khác
 * ============================================================
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const SERVICE_PATH = path.resolve(__dirname, '../../src/services/loyalty.service.js');
const DB_PATH      = path.resolve(__dirname, '../../src/config/db.js');
const QUERIES_PATH = path.resolve(__dirname, '../../src/queries/loyalty.queries.js');

const STUB_QUERIES = {
  GET_USER_LOYALTY: 'STUB', GET_LOYALTY_TIER_BY_NAME: 'STUB',
  CREATE_USER_LOYALTY: 'STUB', INSERT_TRANSACTION: 'STUB', GET_LOYALTY_TIER: 'STUB',
};

function loadLoyaltyService(fakeQuery) {
  [SERVICE_PATH, DB_PATH, QUERIES_PATH].forEach(p => delete require.cache[p]);
  require.cache[DB_PATH] = { id: DB_PATH, filename: DB_PATH, loaded: true, exports: { query: fakeQuery } };
  require.cache[QUERIES_PATH] = { id: QUERIES_PATH, filename: QUERIES_PATH, loaded: true, exports: STUB_QUERIES };
  return require(SERVICE_PATH);
}

function makeMember(overrides = {}) {
  return {
    membership_number: 'VVD123456789', tier_name: 'Member',
    tier_points: '0', current_points: '0', lifetime_points: '0',
    multiplier: '1.0', benefits: [], badge_url_light: null, badge_url_dark: null,
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// TC01 — Tier Member
// ══════════════════════════════════════════════════════════════
test('TC01 ✅ Happy: tier = Member @ 0 điểm, next_tier = Silver', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember()] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.equal(result.tier, 'Member');
  assert.equal(result.next_tier.name, 'Silver');
});

test('TC01 ❌ Failure: tier KHÔNG phải Silver khi mới có 0 điểm', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember()] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.notEqual(result.tier, 'Silver', '0 điểm không thể là Silver (cần 5000)');
});

// ══════════════════════════════════════════════════════════════
// TC02 — Tier Silver
// ══════════════════════════════════════════════════════════════
test('TC02 ✅ Happy: tier = Silver @ 5000 điểm, next_tier = Gold', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Silver', tier_points: '5000' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.equal(result.tier, 'Silver');
  assert.equal(result.next_tier.name, 'Gold');
});

test('TC02 ❌ Failure: progress KHÔNG phải 100% khi vừa đạt ngưỡng Silver', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Silver', tier_points: '5000' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  // Vừa vào Silver = 0% tiến độ đến Gold, không phải 100%
  assert.notEqual(result.progress, 100, 'progress=100 chỉ đúng với Platinum');
});

// ══════════════════════════════════════════════════════════════
// TC03 — Tier Platinum (max)
// ══════════════════════════════════════════════════════════════
test('TC03 ✅ Happy: Platinum → progress = 100, next_tier = null', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Platinum', tier_points: '60000' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.equal(result.progress, 100);
  assert.equal(result.next_tier, null);
});

test('TC03 ❌ Failure: next_tier KHÔNG được có giá trị khi đã max tier', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Platinum', tier_points: '60000' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.ok(result.next_tier === null, `Platinum không có next_tier, thực tế: ${JSON.stringify(result.next_tier)}`);
});

// ══════════════════════════════════════════════════════════════
// TC04 — Progress bar
// ══════════════════════════════════════════════════════════════
test('TC04 ✅ Happy: progress = 50% khi có 2500/5000 điểm (Member→Silver)', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Member', tier_points: '2500' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.equal(result.progress, 50);
});

test('TC04 ❌ Failure: progress KHÔNG được = 0 khi đã có 2500 điểm', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Member', tier_points: '2500' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.notEqual(result.progress, 0, '2500/5000 điểm không thể progress=0');
});

// ══════════════════════════════════════════════════════════════
// TC05 — Benefits tiếng Việt
// ══════════════════════════════════════════════════════════════
test('TC05 ✅ Happy: Silver benefits tiếng Việt có chứa multiplier', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Silver', tier_points: '5000' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.ok(Array.isArray(result.benefits) && result.benefits.length > 0);
  assert.ok(result.benefits[0].includes('1.25x') || result.benefits[0].includes('điểm'));
});

test('TC05 ❌ Failure: benefits KHÔNG được là empty khi tier Silver', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember({ tier_name: 'Silver', tier_points: '5000' })] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.ok(result.benefits.length > 0, 'Silver phải có ít nhất 1 benefit');
});

// ══════════════════════════════════════════════════════════════
// TC06 — Cấu trúc object getMembershipInfo
// ══════════════════════════════════════════════════════════════
test('TC06 ✅ Happy: object trả về có đủ tất cả trường bắt buộc', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember()] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  ['membership_number','tier','lifetime_points','tier_points','current_points',
   'multiplier','next_tier','progress','benefits']
    .forEach(k => assert.ok(k in result, `Thiếu trường "${k}"`));
});

test('TC06 ❌ Failure: membership_number KHÔNG được undefined hoặc null', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [makeMember()] }));
  const result  = await service.getMembershipInfo(1, 'vi');
  assert.ok(result.membership_number != null && result.membership_number !== '',
    'membership_number phải có giá trị');
});

// ══════════════════════════════════════════════════════════════
// TC07 — earnPoints x1.0
// ══════════════════════════════════════════════════════════════
test('TC07 ✅ Happy: Member x1.0 → earnPoints(500k) = 50 điểm', async () => {
  let capturedPoints = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.0' }] };
    if (s.includes('UPDATE user_loyalty') && params?.[0] !== undefined) capturedPoints = params[0];
    return { rows: [{ tier_name: 'Member', tier_points: 50, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 101, 500_000);
  assert.equal(result.pointsEarned, 50);
});

test('TC07 ❌ Failure: earnPoints(500k) KHÔNG được = 0 với multiplier 1.0', async () => {
  let capturedPoints = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.0' }] };
    if (s.includes('UPDATE user_loyalty') && params?.[0] !== undefined) capturedPoints = params[0];
    return { rows: [{ tier_name: 'Member', tier_points: 50, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 101, 500_000);
  assert.notEqual(result.pointsEarned, 0, '500k VNĐ phải tích được điểm');
});

// ══════════════════════════════════════════════════════════════
// TC08 — earnPoints bỏ qua < 10k
// ══════════════════════════════════════════════════════════════
test('TC08 ✅ Happy: bỏ qua tích điểm khi giá vé < 10,000 VNĐ', async () => {
  const fakeQuery = async (sql) => {
    if (typeof sql === 'string' && sql.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.0' }] };
    return { rows: [] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 102, 5_000);
  assert.equal(result.pointsEarned, 0);
});

test('TC08 ❌ Failure: earnPoints(9999) KHÔNG được > 0', async () => {
  const fakeQuery = async (sql) => {
    if (typeof sql === 'string' && sql.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.0' }] };
    return { rows: [] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 102, 9_999);
  assert.equal(result.pointsEarned, 0, 'Giá < 10k không được tích điểm');
});

// ══════════════════════════════════════════════════════════════
// TC09 — earnPoints x1.25
// ══════════════════════════════════════════════════════════════
test('TC09 ✅ Happy: Silver x1.25 → earnPoints(1M) = 125 điểm', async () => {
  let capturedPoints = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.25' }] };
    if (s.includes('UPDATE user_loyalty') && params?.[0] !== undefined) capturedPoints = params[0];
    return { rows: [{ tier_name: 'Silver', tier_points: 125, min_points: 5000, multiplier: '1.25', tier_id: 2 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 103, 1_000_000);
  assert.equal(result.pointsEarned, 125);
});

test('TC09 ❌ Failure: Silver x1.25 KHÔNG được = 100 (sai nếu quên nhân multiplier)', async () => {
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('SELECT lt.multiplier')) return { rows: [{ multiplier: '1.25' }] };
    return { rows: [{ tier_name: 'Silver', tier_points: 125, min_points: 5000, multiplier: '1.25', tier_id: 2 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.earnPointsAfterBooking(1, 103, 1_000_000);
  assert.notEqual(result.pointsEarned, 100, 'Nếu = 100 tức là quên nhân x1.25');
});

// ══════════════════════════════════════════════════════════════
// TC10 — revoke = 0 khi chưa tích điểm
// ══════════════════════════════════════════════════════════════
test('TC10 ✅ Happy: revoke = 0 khi booking chưa có earn transaction', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [] }));
  const result  = await service.revokePointsOnCancel(1, 999);
  assert.equal(result.pointsRevoked, 0);
});

test('TC10 ❌ Failure: revoke KHÔNG được > 0 khi không có transaction', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [] }));
  const result  = await service.revokePointsOnCancel(1, 999);
  assert.ok(result.pointsRevoked === 0, `Không có tx thì không được revoke, thực tế: ${result.pointsRevoked}`);
});

// ══════════════════════════════════════════════════════════════
// TC11 — revoke đúng điểm
// ══════════════════════════════════════════════════════════════
test('TC11 ✅ Happy: revoke đúng 100 điểm đã earn', async () => {
  let updateParams = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('loyalty_transactions') && s.includes("type       = 'earn'")) return { rows: [{ amount: '100' }] };
    if (s.includes('SELECT tier_points, current_points')) return { rows: [{ tier_points: '200', current_points: '150' }] };
    if (s.includes('UPDATE user_loyalty')) { updateParams = params; return { rows: [] }; }
    return { rows: [{ tier_name: 'Member', tier_points: 100, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.revokePointsOnCancel(1, 101);
  assert.equal(result.pointsRevoked, 100);
});

test('TC11 ❌ Failure: revoke KHÔNG được nhiều hơn điểm đã earn (100)', async () => {
  let updateParams = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('loyalty_transactions') && s.includes("type       = 'earn'")) return { rows: [{ amount: '100' }] };
    if (s.includes('SELECT tier_points, current_points')) return { rows: [{ tier_points: '200', current_points: '150' }] };
    if (s.includes('UPDATE user_loyalty')) { updateParams = params; return { rows: [] }; }
    return { rows: [{ tier_name: 'Member', tier_points: 100, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  const result  = await service.revokePointsOnCancel(1, 101);
  assert.ok(result.pointsRevoked <= 100, `Không được revoke quá 100, thực tế: ${result.pointsRevoked}`);
});

// ══════════════════════════════════════════════════════════════
// TC12 — Không để điểm âm
// ══════════════════════════════════════════════════════════════
test('TC12 ✅ Happy: chỉ trừ tối đa bằng số điểm hiện có (floor = 0)', async () => {
  let updateParams = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('loyalty_transactions') && s.includes("type       = 'earn'")) return { rows: [{ amount: '500' }] };
    if (s.includes('SELECT tier_points, current_points')) return { rows: [{ tier_points: '200', current_points: '80' }] };
    if (s.includes('UPDATE user_loyalty')) { updateParams = params; return { rows: [] }; }
    return { rows: [{ tier_name: 'Member', tier_points: 0, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  await service.revokePointsOnCancel(1, 101);
  assert.equal(updateParams[0], 200, 'safeRevokeTier = min(500,200) = 200');
  assert.equal(updateParams[1], 80,  'safeRevokeCurrent = min(500,80) = 80');
});

test('TC12 ❌ Failure: UPDATE KHÔNG được nhận giá trị > điểm hiện có', async () => {
  let updateParams = null;
  const fakeQuery = async (sql, params) => {
    const s = typeof sql === 'string' ? sql : '';
    if (s.includes('loyalty_transactions') && s.includes("type       = 'earn'")) return { rows: [{ amount: '500' }] };
    if (s.includes('SELECT tier_points, current_points')) return { rows: [{ tier_points: '200', current_points: '80' }] };
    if (s.includes('UPDATE user_loyalty')) { updateParams = params; return { rows: [] }; }
    return { rows: [{ tier_name: 'Member', tier_points: 0, min_points: 0, multiplier: '1.0', tier_id: 1 }] };
  };
  const service = loadLoyaltyService(fakeQuery);
  await service.revokePointsOnCancel(1, 101);
  assert.ok(updateParams[0] <= 200, `safeRevokeTier không được > 200, thực tế: ${updateParams[0]}`);
  assert.ok(updateParams[1] <= 80,  `safeRevokeCurrent không được > 80, thực tế: ${updateParams[1]}`);
});

// ══════════════════════════════════════════════════════════════
// TC13 — Cấu trúc object revokePoints
// ══════════════════════════════════════════════════════════════
test('TC13 ✅ Happy: revokePointsOnCancel trả về object có pointsRevoked', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [] }));
  const result  = await service.revokePointsOnCancel(1, 999);
  assert.ok('pointsRevoked' in result, 'Thiếu trường pointsRevoked');
});

test('TC13 ❌ Failure: pointsRevoked KHÔNG được undefined hoặc NaN', async () => {
  const service = loadLoyaltyService(async () => ({ rows: [] }));
  const result  = await service.revokePointsOnCancel(1, 999);
  assert.ok(typeof result.pointsRevoked === 'number' && !isNaN(result.pointsRevoked),
    `pointsRevoked phải là số hợp lệ, thực tế: ${result.pointsRevoked}`);
});
