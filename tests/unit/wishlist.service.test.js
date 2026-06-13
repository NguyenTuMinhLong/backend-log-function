/**
 * ============================================================
 * UNIT TEST — Wishlist Service
 * Chạy: node --test tests/unit/wishlist.service.test.js
 * ============================================================
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const SERVICE_PATH = path.resolve(__dirname, '../../src/services/wishlist.service.js');
const DB_PATH      = path.resolve(__dirname, '../../src/config/db.js');
const Q_PATH       = path.resolve(__dirname, '../../src/queries/wishlist.queries.js');

function loadWishlistService(fakeQuery) {
  [SERVICE_PATH, DB_PATH, Q_PATH].forEach(p => delete require.cache[p]);

  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      query: fakeQuery || (async () => ({ rows: [] }))
    }
  };

  require.cache[Q_PATH] = {
    id: Q_PATH,
    filename: Q_PATH,
    loaded: true,
    exports: {
      FIND_ACTIVE_FLIGHT: 'FIND_ACTIVE_FLIGHT',
      FIND_WISHLIST_BY_USER: 'FIND_WISHLIST_BY_USER',
      INSERT_WISHLIST_USER: 'INSERT_WISHLIST_USER',
      DELETE_WISHLIST_BY_USER: 'DELETE_WISHLIST_BY_USER',
      SELECT_WISHLIST_BY_USER: 'SELECT_WISHLIST_BY_USER'
    }
  };

  return require(SERVICE_PATH);
}

function makeWishlistRow() {
  return {
    id: 1,
    seat_class: 'economy',
    created_at: new Date().toISOString(),
    flight_id: 42,
    flight_number: 'VN123',
    departure_time: new Date().toISOString(),
    arrival_time: new Date().toISOString(),
    duration_minutes: 120,
    flight_status: 'scheduled',
    airline_code: 'VN',
    airline_name: 'Vietnam Airlines',
    logo_url: 'logo.png',
    logo_dark: 'dark.png',
    logo_light: 'light.png',
    dep_code: 'SGN',
    dep_city: 'Ho Chi Minh',
    arr_code: 'HAN',
    arr_city: 'Ha Noi',
    base_price: '1200000',
    available_seats: '20'
  };
}

test('addToWishlist: throw lỗi khi flight_id không hợp lệ', async () => {

  const service = loadWishlistService();

  await assert.rejects(
    () => service.addToWishlist(1, 0, 'economy'),
    /flight_id không hợp lệ/
  );
});

test('addToWishlist: throw lỗi khi seat_class không hợp lệ', async () => {

  const service = loadWishlistService();

  await assert.rejects(
    () => service.addToWishlist(1, 42, 'vip'),
    /seat_class/
  );
});

test('addToWishlist: throw lỗi khi flight không tồn tại', async () => {

  const fakeQuery = async () => ({ rows: [] });

  const service = loadWishlistService(fakeQuery);

  await assert.rejects(
    () => service.addToWishlist(1, 42, 'economy'),
    /Chuyến bay không tồn tại/
  );
});

test('addToWishlist: thêm wishlist thành công', async () => {

  let call = 0;

  const fakeQuery = async () => {
    call++;

    if (call === 1) return { rows: [{ id: 42 }] };
    if (call === 2) return { rows: [] };
    if (call === 3) {
      return {
        rows: [
          {
            id: 1,
            user_id: 1,
            flight_id: 42,
            seat_class: 'economy'
          }
        ]
      };
    }

    return { rows: [] };
  };

  const service = loadWishlistService(fakeQuery);

  const result = await service.addToWishlist(1, 42, 'economy');

  assert.equal(result.message, 'Đã thêm vào danh sách yêu thích');
  assert.equal(result.item.flight_id, 42);
});

test('removeFromWishlist: throw lỗi khi item không tồn tại', async () => {

  const fakeQuery = async () => ({ rows: [] });

  const service = loadWishlistService(fakeQuery);

  await assert.rejects(
    () => service.removeFromWishlist(1, 42, 'economy'),
    /Không tìm thấy chuyến bay/
  );
});

test('removeFromWishlist: xóa wishlist thành công', async () => {

  const fakeQuery = async () => ({
    rows: [{ id: 1 }]
  });

  const service = loadWishlistService(fakeQuery);

  const result = await service.removeFromWishlist(1, 42, 'economy');

  assert.equal(result.message, 'Đã xóa khỏi danh sách yêu thích');
});

test('getWishlist: trả về đúng total và items', async () => {

  const fakeQuery = async () => ({
    rows: [makeWishlistRow()]
  });

  const service = loadWishlistService(fakeQuery);

  const result = await service.getWishlist(1);

  assert.equal(result.total, 1);
  assert.equal(result.items.length, 1);
});

test('getWishlist: object trả về đủ fields', async () => {

  const fakeQuery = async () => ({
    rows: [makeWishlistRow()]
  });

  const service = loadWishlistService(fakeQuery);

  const result = await service.getWishlist(1);

  const item = result.items[0];

  ['id', 'seat_class', 'flight'].forEach(key => {
    assert.ok(key in item);
  });

  ['flight_number', 'departure', 'arrival', 'airline']
    .forEach(key => {
      assert.ok(key in item.flight);
    });
});

test('syncWishlist: skip khi localItems rỗng', async () => {

  const service = loadWishlistService();

  const result = await service.syncWishlist(1, []);

  assert.equal(result.synced, 0);
  assert.equal(result.skipped, 0);
});

test('syncWishlist: sync thành công item hợp lệ', async () => {

  let call = 0;

  const fakeQuery = async () => {
    call++;

    if (call === 1) {
      return { rows: [{ id: 42 }] };
    }

    return {
      rowCount: 1,
      rows: [{ id: 1 }]
    };
  };

  const service = loadWishlistService(fakeQuery);

  const result = await service.syncWishlist(1, [
    {
      flight_id: 42,
      seat_class: 'economy'
    }
  ]);

  assert.equal(result.synced, 1);
});
