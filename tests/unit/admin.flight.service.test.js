const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const servicePath = path.resolve(__dirname, "../../src/services/admin/flight.service.js");
const dbPath = path.resolve(__dirname, "../../src/config/db.js");

function loadAdminFlightService(poolMock) {
  delete require.cache[servicePath];
  delete require.cache[dbPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: poolMock,
  };

  return require(servicePath);
}

test("createFlight: trả lỗi duplicate key khi flights_pkey bị trùng", async () => {
  let connectCalls = 0;
  let insertCalls = 0;

  const poolMock = {
    query: async (sql) => {
      throw new Error(`Unexpected pool.query: ${sql}`);
    },
    connect: async () => {
      connectCalls += 1;

      return {
        query: async (sql) => {
          const normalized = String(sql).replace(/\s+/g, " ").trim();

          if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
            return { rows: [] };
          }

          if (normalized.startsWith("SELECT id FROM airlines")) {
            return { rows: [{ id: 1 }] };
          }

          if (normalized.startsWith("SELECT id FROM airports")) {
            return { rows: [{ id: 10 }] };
          }

          if (normalized.startsWith("INSERT INTO flights")) {
            insertCalls += 1;
            const err = new Error('duplicate key value violates unique constraint "flights_pkey"');
            err.code = "23505";
            err.constraint = "flights_pkey";
            throw err;
          }

          if (normalized.startsWith("INSERT INTO flight_seats")) {
            return { rows: [] };
          }

          throw new Error(`Unexpected client.query: ${sql}`);
        },
        release: () => {},
      };
    },
  };

  const adminFlightService = loadAdminFlightService(poolMock);

  await assert.rejects(
    () =>
      adminFlightService.createFlight({
        flight_number: "VN889",
        airline_id: 1,
        departure_airport_id: 10,
        arrival_airport_id: 11,
        departure_time: "2026-04-21T19:13:00.000Z",
        arrival_time: "2026-04-21T20:13:00.000Z",
        duration_minutes: 60,
        seats: [
          { class: "economy", total_seats: 50, base_price: 1000000, extra_baggage_options: { 0: 0, 5: 50000, 10: 90000, 20: 160000 } },
          { class: "business", total_seats: 20, base_price: 2000000, extra_baggage_options: { 0: 0, 5: 70000, 10: 130000, 20: 240000 } },
          { class: "first", total_seats: 10, base_price: 3000000, extra_baggage_options: { 0: 0, 5: 90000, 10: 170000, 20: 320000 } },
        ],
      }),
    /duplicate key value violates unique constraint "flights_pkey"/
  );

  assert.equal(connectCalls, 1);
  assert.equal(insertCalls, 1);
});

test("createFlight: seat moi khong nhap gia hanh ly them thi dùng mặc định theo hạng ghế", async () => {
  const insertedSeatValues = [];

  const poolMock = {
    query: async (sql) => {
      throw new Error(`Unexpected pool.query: ${sql}`);
    },
    connect: async () => ({
      query: async (sql, params = []) => {
        const normalized = String(sql).replace(/\s+/g, " ").trim();

        if (normalized === "BEGIN" || normalized === "COMMIT" || normalized === "ROLLBACK") {
          return { rows: [] };
        }

        if (normalized.startsWith("SELECT id FROM airlines")) {
          return { rows: [{ id: 1 }] };
        }

        if (normalized.startsWith("SELECT id FROM airports")) {
          return { rows: [{ id: 10 }] };
        }

        if (normalized.startsWith("INSERT INTO flights")) {
          return {
            rows: [{ id: 55, flight_number: "VN500", status: "scheduled" }],
          };
        }

        if (normalized.startsWith("INSERT INTO flight_seats")) {
          insertedSeatValues.push(params);
          return { rows: [] };
        }

        throw new Error(`Unexpected client.query: ${sql}`);
      },
      release: () => {},
    }),
  };

  const adminFlightService = loadAdminFlightService(poolMock);

  const result = await adminFlightService.createFlight({
    flight_number: "VN500",
    airline_id: 1,
    departure_airport_id: 10,
    arrival_airport_id: 11,
    departure_time: "2026-05-01T08:00:00.000Z",
    arrival_time: "2026-05-01T10:00:00.000Z",
    duration_minutes: 120,
    seats: [
      {
        class: "economy",
        total_seats: 50,
        base_price: 1200000,
      },
      {
        class: "business",
        total_seats: 20,
        base_price: 2200000,
      },
      {
        class: "first",
        total_seats: 10,
        base_price: 3200000,
      },
    ],
  });

  assert.deepEqual(result, {
    flight_id: 55,
    flight_number: "VN500",
    status: "scheduled",
  });
  assert.equal(insertedSeatValues.length, 3);

  const economySeatValues = insertedSeatValues.find((params) => params[1] === "economy");
  assert.ok(economySeatValues, "expected economy seat insert values to be captured");
  assert.equal(economySeatValues[0], 55);
  assert.equal(economySeatValues[1], "economy");
  assert.equal(economySeatValues[2], 50);
  assert.equal(economySeatValues[3], 50);
  assert.equal(economySeatValues[4], 1200000);
  assert.equal(economySeatValues[5], 23);
  assert.equal(economySeatValues[6], 7);
  assert.equal(economySeatValues[7], 250000);
});
