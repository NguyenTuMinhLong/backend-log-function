/**
 * ============================================================
 *  UNIT TEST — Flight Tracker (getFlightPosition)
 *  Chạy: node --test tests/unit/flight.tracker.test.js
 * ============================================================
 *
 *  Kỹ thuật: Manual Module Mock (inject cache)
 *  - Không cần jest / sinon
 *  - Dùng require.cache để stub pool.query và flight.queries
 *  - Mỗi test gọi loadFlightService() để nạp lại module sạch
 * ============================================================
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

// ── Đường dẫn tới module cần test ──────────────────────────────────────────
const SERVICE_PATH = path.resolve(__dirname, '../../src/services/flight.service.js');
const DB_PATH      = path.resolve(__dirname, '../../src/config/db.js');
const QF_PATH      = path.resolve(__dirname, '../../src/queries/flight.queries.js');

// ── Helper: nạp lại flight.service với db.query giả ──────────────────────
function loadFlightService(fakeQuery) {
  // Xóa cache để đảm bảo module được nạp lại từ đầu
  [SERVICE_PATH, DB_PATH, QF_PATH].forEach(p => delete require.cache[p]);

  // Inject stub db
  require.cache[DB_PATH] = {
    id: DB_PATH, filename: DB_PATH, loaded: true,
    exports: { query: fakeQuery || (async () => ({ rows: [] })) },
  };

  // Inject stub queries (chỉ cần key tồn tại, giá trị không quan trọng
  // vì db.query đã được stub hoàn toàn)
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

// ── Dữ liệu mẫu cho một chuyến bay đang bay ──────────────────────────────
function makeFlight(overrides = {}) {
  const now         = Date.now();
  const depTime     = new Date(now - 30 * 60 * 1000).toISOString(); // đã cất cánh 30 phút
  const durationMin = 120;
  return {
    id: 42,
    flight_number:  'VN100',
    departure_time: depTime,
    duration_minutes: durationMin,
    dep_code: 'SGN', dep_city: 'Hồ Chí Minh',
    dep_lat: '10.8188',  dep_lng: '106.6520',
    arr_code: 'HAN', arr_city: 'Hà Nội',
    arr_lat: '21.2187',  arr_lng: '105.8045',
    ...overrides,
  };
}

// ============================================================
// 1. Ném lỗi khi không tìm thấy chuyến bay
// ============================================================
test('getFlightPosition: ném lỗi khi flight_id không tồn tại', async () => {
  const service = loadFlightService(async () => ({ rows: [] }));

  await assert.rejects(
    () => service.getFlightPosition(9999),
    /Không tìm thấy chuyến bay/,
    'Phải throw lỗi "Không tìm thấy chuyến bay"'
  );
});

// ============================================================
// 2. Trạng thái "scheduled" khi chưa đến giờ bay
// ============================================================
test('getFlightPosition: status = scheduled khi chưa đến giờ bay', async () => {
  const futureTime = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(); // 2 tiếng nữa
  const flight = makeFlight({ departure_time: futureTime });
  const service = loadFlightService(async () => ({ rows: [flight] }));

  const result = await service.getFlightPosition(42);

  assert.equal(result.status, 'scheduled', 'Chuyến chưa cất cánh phải là scheduled');
  assert.equal(result.progress, 0, 'Progress phải = 0 khi chưa cất cánh');
});

// ============================================================
// 3. Trạng thái "airborne" và progress đúng khi đang bay
// ============================================================
test('getFlightPosition: status = airborne và progress hợp lệ khi đang bay', async () => {
  // Đã bay được 60 phút, tổng 120 phút → progress ≈ 0.5
  const now = Date.now();
  const depTime = new Date(now - 60 * 60 * 1000).toISOString();
  const flight = makeFlight({ departure_time: depTime, duration_minutes: 120 });
  const service = loadFlightService(async () => ({ rows: [flight] }));

  const result = await service.getFlightPosition(42);

  assert.equal(result.status, 'airborne', 'Chuyến đang bay phải là airborne');
  assert.ok(result.progress > 0 && result.progress < 1,
    `progress phải trong khoảng (0, 1), thực tế: ${result.progress}`);
  // ~50% với sai số nhỏ do thời gian chạy test
  assert.ok(Math.abs(result.progress - 0.5) < 0.02,
    `Sau 60/120 phút, progress ≈ 0.5, thực tế: ${result.progress}`);
});

// ============================================================
// 4. Trạng thái "landed" khi đã đến nơi
// ============================================================
test('getFlightPosition: status = landed khi đã hạ cánh', async () => {
  const depTime = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(); // 3h trước
  const flight  = makeFlight({ departure_time: depTime, duration_minutes: 120 }); // chuyến 2h
  const service = loadFlightService(async () => ({ rows: [flight] }));

  const result = await service.getFlightPosition(42);

  assert.equal(result.status, 'landed', 'Chuyến đã hạ cánh phải là landed');
  assert.equal(result.progress, 1, 'Progress phải = 1 khi đã landed');
  assert.equal(result.timeRemaining, 0, 'timeRemaining phải = 0 khi đã landed');
});

// ============================================================
// 5. Vị trí nội suy đúng khi progress = 0 (ngay lúc cất cánh)
// ============================================================
test('getFlightPosition: vị trí = sân bay đi khi progress = 0', async () => {
  const depTime = new Date(Date.now()).toISOString(); // cất cánh đúng lúc này
  const flight  = makeFlight({ departure_time: depTime });
  const service = loadFlightService(async () => ({ rows: [flight] }));

  const result = await service.getFlightPosition(42);

  // Vị trí phải ≈ tọa độ sân bay đi (SGN)
  assert.ok(Math.abs(result.position.lat - 10.8188) < 0.01,
    `lat phải ≈ 10.8188 (SGN), thực tế: ${result.position.lat}`);
  assert.ok(Math.abs(result.position.lng - 106.6520) < 0.01,
    `lng phải ≈ 106.6520 (SGN), thực tế: ${result.position.lng}`);
});

// ============================================================
// 6. Cấu trúc object trả về đúng format
// ============================================================
test('getFlightPosition: object trả về có đủ các trường bắt buộc', async () => {
  const flight  = makeFlight();
  const service = loadFlightService(async () => ({ rows: [flight] }));

  const result = await service.getFlightPosition(42);

  // Kiểm tra các trường bắt buộc
  ['flightId', 'flightNumber', 'status', 'progress', 'timeRemaining', 'position', 'departure', 'arrival']
    .forEach(key => {
      assert.ok(key in result, `Thiếu trường "${key}" trong kết quả`);
    });

  // Kiểm tra sub-object position
  ['lat', 'lng', 'heading'].forEach(key => {
    assert.ok(key in result.position, `Thiếu trường "position.${key}"`);
  });

  // Kiểm tra departure/arrival
  ['code', 'city', 'lat', 'lng', 'time'].forEach(key => {
    assert.ok(key in result.departure, `Thiếu trường "departure.${key}"`);
    assert.ok(key in result.arrival,   `Thiếu trường "arrival.${key}"`);
  });
});

// ============================================================
// 7. timeRemaining > 0 khi đang bay
// ============================================================
test('getFlightPosition: timeRemaining > 0 khi đang airborne', async () => {
  const flight  = makeFlight(); // đã bay 30/120 phút
  const service = loadFlightService(async () => ({ rows: [flight] }));

  const result = await service.getFlightPosition(42);

  assert.equal(result.status, 'airborne');
  assert.ok(result.timeRemaining > 0,
    `timeRemaining phải > 0, thực tế: ${result.timeRemaining}`);
  // Khoảng 90 phút còn lại (±1 phút)
  const expected = 90 * 60 * 1000;
  assert.ok(Math.abs(result.timeRemaining - expected) < 60_000,
    `timeRemaining ≈ 90 phút, thực tế: ${result.timeRemaining}ms`);
});
