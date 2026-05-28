/**
 * ============================================================
 * UNIT TEST — Ancillary Service
 * Chạy: node --test tests/unit/ancillary.service.test.js
 * ============================================================
 */

const test   = require('node:test');
const assert = require('node:assert/strict');
const path   = require('node:path');

const SERVICE_PATH = path.resolve(__dirname, '../../src/services/ancillary.service.js');
const DB_PATH      = path.resolve(__dirname, '../../src/config/db.js');
const Q_PATH       = path.resolve(__dirname, '../../src/queries/ancillary.queries.js');

function makeClient(fakeQuery) {
  return {
    query: fakeQuery,
    release: () => {}
  };
}

function loadAncillaryService(fakeQuery) {

  [SERVICE_PATH, DB_PATH, Q_PATH].forEach(p => delete require.cache[p]);

  require.cache[DB_PATH] = {
    id: DB_PATH,
    filename: DB_PATH,
    loaded: true,
    exports: {
      query: fakeQuery || (async () => ({ rows: [] })),
      connect: async () => makeClient(fakeQuery || (async () => ({ rows: [] })))
    }
  };

  require.cache[Q_PATH] = {
    id: Q_PATH,
    filename: Q_PATH,
    loaded: true,
    exports: {
      GET_ANCILLARY_OPTIONS: 'GET_ANCILLARY_OPTIONS',
      GET_ANCILLARIES_BY_BOOKING: 'GET_ANCILLARIES_BY_BOOKING',
      GET_ANCILLARY_TOTAL: 'GET_ANCILLARY_TOTAL',
      CHECK_PASSENGER_IN_BOOKING: 'CHECK_PASSENGER_IN_BOOKING',
      GET_ANCILLARY_OPTION_BY_ID: 'GET_ANCILLARY_OPTION_BY_ID',
      CHECK_DUPLICATE_ANCILLARY: 'CHECK_DUPLICATE_ANCILLARY',
      INSERT_ANCILLARY: 'INSERT_ANCILLARY',
      CANCEL_ANCILLARY: 'CANCEL_ANCILLARY'
    }
  };

  return require(SERVICE_PATH);
}

test('getAncillaryOptions: throw lỗi khi type không hợp lệ', async () => {

  const service = loadAncillaryService();

  await assert.rejects(
    () => service.getAncillaryOptions('premium'),
    /type phải/
  );
});

test('getAncillaryOptions: group đúng theo type', async () => {

  const fakeQuery = async () => ({
    rows: [
      {
        id: 1,
        type: 'meal',
        name: 'Meal A',
        description: 'Hot meal',
        price: '10',
        unit: 'set',
        meta: {}
      }
    ]
  });

  const service = loadAncillaryService(fakeQuery);

  const result = await service.getAncillaryOptions();

  assert.ok(result.types.includes('meal'));
  assert.equal(result.options.meal.length, 1);
});

test('addAncillary: throw lỗi khi thiếu passenger_id', async () => {

  const service = loadAncillaryService();

  await assert.rejects(
    () => service.addAncillary(1, {
      ancillary_option_id: 1
    }),
    /passenger_id/
  );
});

test('addAncillary: throw lỗi khi quantity < 1', async () => {

  const service = loadAncillaryService();

  await assert.rejects(
    () => service.addAncillary(1, {
      passenger_id: 1,
      ancillary_option_id: 1,
      quantity: 0
    }),
    /quantity/
  );
});

test('addAncillary: throw lỗi khi passenger không thuộc booking', async () => {

  const fakeQuery = async (query) => {

    if (query === 'BEGIN' || query === 'ROLLBACK') {
      return { rows: [] };
    }

    return { rows: [] };
  };

  const service = loadAncillaryService(fakeQuery);

  await assert.rejects(
    () => service.addAncillary(1, {
      passenger_id: 1,
      ancillary_option_id: 1
    }),
    /Hành khách không thuộc booking này/
  );
});

test('addAncillary: thêm ancillary thành công', async () => {

  let call = 0;

  const fakeQuery = async (query) => {

    call++;

    if (query === 'BEGIN' || query === 'COMMIT') {
      return { rows: [] };
    }

    if (call === 2) {
      return {
        rows: [{ id: 1 }]
      };
    }

    if (call === 3) {
      return {
        rows: [{
          id: 1,
          is_active: true,
          name: 'Extra Baggage',
          type: 'baggage',
          price: '20'
        }]
      };
    }

    if (call === 4) {
      return {
        rows: [{
          id: 99
        }]
      };
    }

    return {
      rows: [{
        ancillary_total: '20'
      }]
    };
  };

  const service = loadAncillaryService(fakeQuery);

  const result = await service.addAncillary(1, {
    passenger_id: 1,
    ancillary_option_id: 1,
    quantity: 1
  });

  assert.equal(result.message, 'Đã thêm dịch vụ bổ sung thành công');
  assert.equal(result.total_price, 20);
});

test('removeAncillary: throw lỗi khi ancillary không tồn tại', async () => {

  const fakeQuery = async (query) => {

    if (query === 'BEGIN' || query === 'ROLLBACK') {
      return { rows: [] };
    }

    return { rows: [] };
  };

  const service = loadAncillaryService(fakeQuery);

  await assert.rejects(
    () => service.removeAncillary(1, 99),
    /Không tìm thấy dịch vụ bổ sung/
  );
});

test('removeAncillary: remove ancillary thành công', async () => {

  let call = 0;

  const fakeQuery = async (query) => {

    call++;

    if (query === 'BEGIN' || query === 'COMMIT') {
      return { rows: [] };
    }

    if (call === 2) {
      return {
        rows: [{ id: 1 }]
      };
    }

    return {
      rows: [{
        ancillary_total: '0'
      }]
    };
  };

  const service = loadAncillaryService(fakeQuery);

  const result = await service.removeAncillary(1, 1);

  assert.equal(result.message, 'Đã huỷ dịch vụ bổ sung');
});

test('getBookingTotal: throw lỗi khi booking không tồn tại', async () => {

  const fakeQuery = async (query) => {

    if (String(query).includes('SELECT total_price')) {
      return { rows: [] };
    }

    return {
      rows: [{
        ancillary_total: '0'
      }]
    };
  };

  const service = loadAncillaryService(fakeQuery);

  await assert.rejects(
    () => service.getBookingTotal(999),
    /Không tìm thấy booking/
  );
});

test('getBookingTotal: tính grand_total đúng', async () => {

  const fakeQuery = async (query) => {

    if (String(query).includes('SELECT total_price')) {
      return {
        rows: [{
          total_price: '100'
        }]
      };
    }

    return {
      rows: [{
        ancillary_total: '20'
      }]
    };
  };

  const service = loadAncillaryService(fakeQuery);

  const result = await service.getBookingTotal(1);

  assert.equal(result.ticket_price, 100);
  assert.equal(result.ancillary_total, 20);
  assert.equal(result.grand_total, 120);
});
