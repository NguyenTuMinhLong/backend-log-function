"use strict";

/**
 * Debug script: kiểm tra từng bước recommendation
 * Chạy: node scripts/debug-recommendation.js
 */

require("dotenv").config();
const pool = require("../src/config/db");
const Q = require("../src/queries/recommendation.queries");

async function debug() {
  console.log("=".repeat(60));
  console.log("🔍 RECOMMENDATION DEBUG");
  console.log("=".repeat(60));

  const client = await pool.connect();

  try {
    // ── 1. Khoảng tháng ────────────────────────────────────────
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const monthStart = new Date(year, month - 1, 1);
    const monthEnd = new Date(year, month, 0, 23, 59, 59);

    console.log("\n📅 [1] Month range:");
    console.log("   Year:", year, "Month:", month);
    console.log("   Start:", monthStart.toISOString());
    console.log("   End:", monthEnd.toISOString());
    console.log("   Today:", now.toISOString());

    // ── 2. Kiểm tra bảng flights ─────────────────────────────
    console.log("\n✈️ [2] Flights table check:");

    const flightCount = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status = 'scheduled') AS scheduled,
             COUNT(*) FILTER (WHERE is_active = TRUE) AS active,
             COUNT(*) FILTER (WHERE status = 'scheduled' AND is_active = TRUE) AS active_scheduled
      FROM flights
    `);
    console.log("   Total flights:", flightCount.rows[0].total);
    console.log("   Status = 'scheduled':", flightCount.rows[0].scheduled);
    console.log("   is_active = TRUE:", flightCount.rows[0].active);
    console.log("   scheduled + active:", flightCount.rows[0].active_scheduled);

    // ── 3. Kiểm tra departure_time trong tháng ─────────────────
    console.log("\n🗓️ [3] Flights in current month:");

    const monthFlights = await client.query(`
      SELECT COUNT(*) AS cnt,
             MIN(departure_time) AS earliest,
             MAX(departure_time) AS latest
      FROM flights
      WHERE departure_time BETWEEN $1 AND $2
    `, [monthStart.toISOString(), monthEnd.toISOString()]);
    console.log("   Flights in month:", monthFlights.rows[0].cnt);
    console.log("   Earliest:", monthFlights.rows[0].earliest);
    console.log("   Latest:", monthFlights.rows[0].latest);

    // ── 4. Kiểm tra flight_seats ──────────────────────────────
    console.log("\n💺 [4] flight_seats check:");

    const seatCheck = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE class = 'economy') AS economy,
             COUNT(*) FILTER (WHERE available_seats > 0) AS with_seats
      FROM flight_seats
    `);
    console.log("   Total seats:", seatCheck.rows[0].total);
    console.log("   Economy class:", seatCheck.rows[0].economy);
    console.log("   With available seats:", seatCheck.rows[0].with_seats);

    // ── 5. Schema check ────────────────────────────────────────────
    console.log("\n🔎 [5] Schema check:");

    const hrSchema = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'holiday_rules'
      ORDER BY ordinal_position
    `);
    console.log("   holiday_rules columns:", hrSchema.rows.map(r => r.column_name).join(", "));

    const hSchema = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'holidays'
      ORDER BY ordinal_position
    `);
    console.log("   holidays columns:", hSchema.rows.map(r => r.column_name).join(", "));

    // ── 6. SELECT_FLIGHTS_FOR_TIME_GROUPING ────────────────────
    console.log("\n🛫 [6] SELECT_FLIGHTS_FOR_TIME_GROUPING:");

    const step6 = await client.query(Q.SELECT_FLIGHTS_FOR_TIME_GROUPING, [
      monthStart.toISOString(),
      monthEnd.toISOString(),
    ]);
    console.log("   Rows returned:", step6.rows.length);

    if (step6.rows.length > 0) {
      const r = step6.rows[0];
      console.log("   Sample:", r.flight_number, r.departure_code, "→", r.arrival_code);
      console.log("   base_price:", r.base_price, "price_multiplier:", r.price_multiplier);
      console.log("   holiday_id:", r.holiday_id, "holiday_name:", r.holiday_name);
    }

    // ── 6. Holidays ─────────────────────────────────────────────
    console.log("\n🎊 [6] Holidays check:");

    const holidays = await client.query(Q.SELECT_HOLIDAYS_IN_RANGE, [
      monthStart.toISOString().split("T")[0],
      monthEnd.toISOString().split("T")[0],
    ]);
    console.log("   Holidays in range:", holidays.rows.length);
    holidays.rows.forEach((h) => {
      console.log("   -", h.date, h.name, h.type);
    });

    // ── 7. holiday_rules schema ──────────────────────────────────
    console.log("\n📋 [7] holiday_rules schema & data:");

    const rulesSchema = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'holiday_rules'
      ORDER BY ordinal_position
    `);
    console.log("   Columns:", rulesSchema.rows.map(r => r.column_name).join(", "));

    const rules = await client.query(`SELECT * FROM holiday_rules LIMIT 5`);
    console.log("   Rows in table:", rules.rows.length);
    if (rules.rows.length > 0) {
      console.log("   Sample keys:", Object.keys(rules.rows[0]).join(", "));
      console.log("   Sample row:", JSON.stringify(rules.rows[0]));
    }

    // ── 8. Bookings ─────────────────────────────────────────────
    console.log("\n📝 [8] Bookings check:");

    const bookings = await client.query(`
      SELECT COUNT(*) AS total,
             COUNT(*) FILTER (WHERE status IN ('confirmed','completed')) AS valid,
             COUNT(DISTINCT user_id) AS unique_users
      FROM bookings
    `);
    console.log("   Total bookings:", bookings.rows[0].total);
    console.log("   Valid (confirmed/completed):", bookings.rows[0].valid);
    console.log("   Unique users:", bookings.rows[0].unique_users);

    // ── 9. Search history ───────────────────────────────────────
    console.log("\n🔍 [9] search_history check:");

    const searchHist = await client.query(`SELECT COUNT(*) AS total FROM search_history`);
    console.log("   Total search_history rows:", searchHist.rows[0].total);

    // ── 10. Test SELECT_TOP_POPULAR_FLIGHTS ─────────────────────
    console.log("\n🔥 [10] SELECT_TOP_POPULAR_FLIGHTS:");
    const popular = await client.query(Q.SELECT_TOP_POPULAR_FLIGHTS, [
      monthStart.toISOString(),
      monthEnd.toISOString(),
      100,
    ]);
    console.log("   Rows returned:", popular.rows.length);

    // ── 11. Timezone check ────────────────────────────────────────
    console.log("\n🌍 [11] Timezone check:");
    const tzCheck = await client.query(`SELECT NOW() AS now, CURRENT_DATE AS today, EXTRACT(HOUR FROM NOW()) AS hour_utc`);
    console.log("   DB NOW():", tzCheck.rows[0].now);
    console.log("   DB CURRENT_DATE:", tzCheck.rows[0].today);
    console.log("   UTC hour:", tzCheck.rows[0].hour_utc);

  } catch (err) {
    console.error("❌ Error:", err.message);
    console.error(err.stack);
  } finally {
    client.release();
    await pool.end();
  }

  console.log("\n" + "=".repeat(60));
  console.log("✅ Debug complete");
}

debug();
