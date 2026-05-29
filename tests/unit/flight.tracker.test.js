/**
 * ============================================================
 *  UNIT TEST — Flight Tracker (getFlightPosition)
 *  Chạy: node --test tests/unit/flight.tracker.test.js
 *
 *  Mỗi TC có 2 luồng:
 *    ✅ Happy path  — input hợp lệ → kết quả đúng
 *    ❌ Failure path — input sai / edge case → expect lỗi hoặc giá trị khác
 * ============================================================
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const SERVICE_PATH = path.resolve(__dirname, '../../src/services/flight.service.js');
const DB_PATH      = path.resolve(__dirname, '../../src/config/db.js');
const QF_PATH      = path.resolve(__dirname, '../../src/queries/flight.queries.js');

function loadFlightService(fakeQuery) {
  [SERVICE_PATH, DB_PATH, QF_PATH].forEach(p => delete require.cache[p]);
  require.cache[DB_PATH] = {
    id: DB_PATH, filename: DB_PATH, loaded: true,
    exports: { query: fakeQuery || (async () => ({ rows: [] })) },
  };
  require.cache[QF_PATH] = {
    id: QF_PATH, filename: QF_PATH, loaded: true,
    exports: {
      SELECT_FLIGHT_POSITION: 'STUB_QUERY',
      SEARCH_FLIGHTS: () => 'STUB_SEARCH',
      SELECT_ALL_AIRPORTS: 'STUB_AIRPORTS',
      SELECT_ALL_AIRLINES: 'STUB_AIRLINES',
    },
  };
  return require(SERVICE_PATH);
}

function makeFlight(overrides = {}) {
  const now = Date.now();
  return {
    id: 42, flight_number: 'VN100',
    departure_time: new Date(now - 30 * 60 * 1000).toISOString(),
    duration_minutes: 120,
    dep_code: 'SGN', dep_city: 'Hồ Chí Minh',
    dep_lat: '10.8188', dep_lng: '106.6520',
    arr_code: 'HAN', arr_city: 'Hà Nội',
    arr_lat: '21.2187', arr_lng: '105.8045',
    ...overrides,
  };
}

// ══════════════════════════════════════════════════════════════
// TC01 — Flight không tồn tại
// ══════════════════════════════════════════════════════════════
test('TC01 ✅ Happy: ném lỗi khi flight_id không tồn tại', async () => {
  const service = loadFlightService(async () => ({ rows: [] }));
  await assert.rejects(
    () => service.getFlightPosition(9999),
    /Không tìm thấy chuyến bay/
  );
});

test('TC01 ❌ Failure: không ném lỗi khi có dữ liệu — assert.rejects phải fail', async () => {
  const flight  = makeFlight();
  const service = loadFlightService(async () => ({ rows: [flight] }));
  // Khi có flight, hàm KHÔNG throw → rejects phải fail
  await assert.rejects(
    async () => {
      const result = await service.getFlightPosition(42);
      if (result && result.flightId) throw new Error('EXPECTED_NO_THROW_BUT_GOT_RESULT');
    },
    /EXPECTED_NO_THROW_BUT_GOT_RESULT/
  );
});

// ══════════════════════════════════════════════════════════════
// TC02 — Status: scheduled
// ══════════════════════════════════════════════════════════════
test('TC02 ✅ Happy: status = scheduled khi chưa đến giờ bay', async () => {
  const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: futureTime })] }));
  const result  = await service.getFlightPosition(42);
  assert.equal(result.status, 'scheduled');
  assert.equal(result.progress, 0);
});

test('TC02 ❌ Failure: status KHÔNG phải scheduled khi đã cất cánh', async () => {
  // Đã bay 30 phút → airborne, không phải scheduled
  const service = loadFlightService(async () => ({ rows: [makeFlight()] }));
  const result  = await service.getFlightPosition(42);
  assert.notEqual(result.status, 'scheduled', 'Chuyến đang bay không được là scheduled');
});

// ══════════════════════════════════════════════════════════════
// TC03 — Status: airborne + progress
// ══════════════════════════════════════════════════════════════
test('TC03 ✅ Happy: status = airborne, progress ≈ 0.5 sau 60/120 phút', async () => {
  const depTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: depTime, duration_minutes: 120 })] }));
  const result  = await service.getFlightPosition(42);
  assert.equal(result.status, 'airborne');
  assert.ok(Math.abs(result.progress - 0.5) < 0.02, `progress phải ≈ 0.5, thực tế: ${result.progress}`);
});

test('TC03 ❌ Failure: progress KHÔNG được = 1 khi đang airborne', async () => {
  const depTime = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: depTime, duration_minutes: 120 })] }));
  const result  = await service.getFlightPosition(42);
  assert.notEqual(result.progress, 1, 'progress=1 chỉ hợp lệ khi landed');
});

// ══════════════════════════════════════════════════════════════
// TC04 — Status: landed
// ══════════════════════════════════════════════════════════════
test('TC04 ✅ Happy: status = landed, progress = 1, timeRemaining = 0', async () => {
  const depTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: depTime, duration_minutes: 120 })] }));
  const result  = await service.getFlightPosition(42);
  assert.equal(result.status, 'landed');
  assert.equal(result.progress, 1);
  assert.equal(result.timeRemaining, 0);
});

test('TC04 ❌ Failure: timeRemaining KHÔNG được > 0 khi đã landed', async () => {
  const depTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: depTime, duration_minutes: 120 })] }));
  const result  = await service.getFlightPosition(42);
  assert.ok(result.timeRemaining === 0, `Landed phải timeRemaining=0, thực tế: ${result.timeRemaining}`);
});

// ══════════════════════════════════════════════════════════════
// TC05 — Vị trí nội suy
// ══════════════════════════════════════════════════════════════
test('TC05 ✅ Happy: vị trí ≈ sân bay đi (SGN) khi progress = 0', async () => {
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: new Date().toISOString() })] }));
  const result  = await service.getFlightPosition(42);
  assert.ok(Math.abs(result.position.lat - 10.8188) < 0.05);
  assert.ok(Math.abs(result.position.lng - 106.6520) < 0.05);
});

test('TC05 ❌ Failure: vị trí KHÔNG phải sân bay đến (HAN) khi progress < 1', async () => {
  const service = loadFlightService(async () => ({ rows: [makeFlight({ departure_time: new Date().toISOString() })] }));
  const result  = await service.getFlightPosition(42);
  // Nếu progress=0, không được ở HAN (21.2187, 105.8045)
  assert.ok(Math.abs(result.position.lat - 21.2187) > 1, 'Không được ở tọa độ HAN khi chưa đến nơi');
});

// ══════════════════════════════════════════════════════════════
// TC06 — Cấu trúc object trả về
// ══════════════════════════════════════════════════════════════
test('TC06 ✅ Happy: object có đủ tất cả trường bắt buộc', async () => {
  const service = loadFlightService(async () => ({ rows: [makeFlight()] }));
  const result  = await service.getFlightPosition(42);
  ['flightId','flightNumber','status','progress','timeRemaining','position','departure','arrival']
    .forEach(k => assert.ok(k in result, `Thiếu trường "${k}"`));
});

test('TC06 ❌ Failure: trường position phải có lat, lng, heading — không được thiếu', async () => {
  const service = loadFlightService(async () => ({ rows: [makeFlight()] }));
  const result  = await service.getFlightPosition(42);
  ['lat','lng','heading'].forEach(k => {
    assert.ok(k in result.position, `position thiếu trường "${k}"`);
    assert.ok(result.position[k] !== undefined, `position.${k} không được undefined`);
  });
});

// ══════════════════════════════════════════════════════════════
// TC07 — timeRemaining
// ══════════════════════════════════════════════════════════════
test('TC07 ✅ Happy: timeRemaining ≈ 90 phút khi đã bay 30/120 phút', async () => {
  const service = loadFlightService(async () => ({ rows: [makeFlight()] }));
  const result  = await service.getFlightPosition(42);
  const expected = 90 * 60 * 1000;
  assert.ok(Math.abs(result.timeRemaining - expected) < 60_000,
    `timeRemaining phải ≈ 90 phút, thực tế: ${result.timeRemaining}ms`);
});

test('TC07 ❌ Failure: timeRemaining KHÔNG được = 0 khi đang airborne', async () => {
  const service = loadFlightService(async () => ({ rows: [makeFlight()] }));
  const result  = await service.getFlightPosition(42);
  assert.notEqual(result.timeRemaining, 0, 'Chuyến đang bay phải còn thời gian');
});
