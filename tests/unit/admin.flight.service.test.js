const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const servicePath = path.resolve(__dirname, "../../src/services/admin.flight.service.js");
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

test("createFlight: tu dong reset sequence va retry khi flights_pkey bi trung", async () => {
  let connectCalls = 0;
  let insertCalls = 0;
  let resyncCalls = 0;

  const poolMock = {
    query: async (sql) => {
      if (String(sql).includes("pg_get_serial_sequence")) {
        resyncCalls += 1;
        return { rows: [{ setval: 101 }] };
      }

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

            if (insertCalls === 1) {
              const err = new Error('duplicate key value violates unique constraint "flights_pkey"');
              err.code = "23505";
              err.constraint = "flights_pkey";
              throw err;
            }

            return {
              rows: [{ id: 101, flight_number: "VN889", status: "scheduled" }],
            };
          }

          throw new Error(`Unexpected client.query: ${sql}`);
        },
        release: () => {},
      };
    },
  };

  const adminFlightService = loadAdminFlightService(poolMock);

  const result = await adminFlightService.createFlight({
    flight_number: "VN889",
    airline_id: 1,
    departure_airport_id: 10,
    arrival_airport_id: 11,
    departure_time: "2026-04-21T19:13:00.000Z",
    arrival_time: "2026-04-21T20:13:00.000Z",
    duration_minutes: 60,
  });

  assert.equal(connectCalls, 2);
  assert.equal(insertCalls, 2);
  assert.equal(resyncCalls, 1);
  assert.deepEqual(result, {
    flight_id: 101,
    flight_number: "VN889",
    status: "scheduled",
  });
});
