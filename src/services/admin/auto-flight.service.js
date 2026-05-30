'use strict';

const pool = require('../../config/db');
const QF   = require('../../queries/flight.queries');

// ─── Price helpers (mirrors frontend calcPrices) ─────────────────────────────

// Base price per minute — tuned to match real Vietnamese airline pricing
const BASE_ECO_PER_MIN = 15000;

// Peak-hour multiplier (baked into base_price at creation)
const getTimeMult = (hour) => {
  const h = Number(hour);
  if (h >= 5  && h <= 7)  return 1.10;
  if (h >= 8  && h <= 10) return 1.25;
  if (h >= 11 && h <= 14) return 1.00;
  if (h >= 15 && h <= 17) return 1.10;
  if (h >= 18 && h <= 21) return 1.20;
  return 0.85;
};

// Day-of-week + advance mults are applied at search time (flight.service.js),
// so base_price only reflects route distance + tier + departure hour.
const calcPrices = (durationMins, tierMult, depHour) => {
  const timeMult = getTimeMult(depHour);
  const eco = Math.round(durationMins * BASE_ECO_PER_MIN * tierMult * timeMult / 10000) * 10000;
  return {
    economy:  eco,
    business: Math.round(eco * 2.8 / 10000) * 10000,
    first:    Math.round(eco * 5.5 / 10000) * 10000,
  };
};

const autoExtraBagPrice = (basePrice, cls) => {
  if (!basePrice || cls === 'first') return 0;
  const ratio = cls === 'business' ? 0.025 : 0.045;
  return Math.max(5000, Math.round(basePrice * ratio / 1000) * 1000);
};

const haversineKm = (lat1, lng1, lat2, lng2) => {
  const R = 6371, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
};

const estimateMins = (km) => {
  if (km <= 500)  return Math.round(km / 500 * 60) + 40;
  if (km <= 1500) return Math.round(km / 700 * 60) + 25;
  if (km <= 4000) return Math.round(km / 820 * 60) + 30;
  if (km <= 8000) return Math.round(km / 860 * 60) + 40;
  return Math.round(km / 900 * 60) + 60;
};

// ─── Time-slot helpers ────────────────────────────────────────────────────────

// Spread N time-slots evenly from 06:00 to 22:00
const getTimeSlots = (n) => {
  if (n <= 0) return [];
  const start = 6 * 60;  // 360 mins
  const end   = 22 * 60; // 1320 mins
  if (n === 1) return ['14:00'];
  return Array.from({ length: n }, (_, i) => {
    const mins = Math.round(start + ((end - start) * i) / (n - 1));
    return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
  });
};

const addMins = (dateStr, timeStr, durationMins) => {
  const dt = new Date(`${dateStr}T${timeStr}:00`);
  dt.setMinutes(dt.getMinutes() + durationMins);
  return dt.toISOString().replace('Z', '').replace('T', ' ').slice(0, 19);
};

// ─── Seat config ──────────────────────────────────────────────────────────────

const SEAT_CONFIG = [
  { class: 'economy',  total_seats: 200, baggage_included_kg: 23, carry_on_kg: 7  },
  { class: 'business', total_seats: 40,  baggage_included_kg: 32, carry_on_kg: 12 },
  { class: 'first',    total_seats: 20,  baggage_included_kg: 40, carry_on_kg: 15 },
];

// ─── Config CRUD ──────────────────────────────────────────────────────────────

const getConfig = async () => {
  const { rows } = await pool.query('SELECT * FROM auto_flight_config WHERE id = 1');
  return rows[0] || null;
};

const saveConfig = async ({ is_enabled, start_date, end_date, flights_per_route, advance_days, max_routes_per_airline }) => {
  const { rows } = await pool.query(`
    UPDATE auto_flight_config SET
      is_enabled              = COALESCE($1, is_enabled),
      start_date              = COALESCE($2::date, start_date),
      end_date                = COALESCE($3::date, end_date),
      flights_per_route       = COALESCE($4, flights_per_route),
      advance_days            = COALESCE($5, advance_days),
      max_routes_per_airline  = COALESCE($6, max_routes_per_airline)
    WHERE id = 1
    RETURNING *
  `, [
    is_enabled               !== undefined ? is_enabled               : null,
    start_date               || null,
    end_date                 || null,
    flights_per_route        != null       ? flights_per_route        : null,
    advance_days             != null       ? advance_days             : null,
    max_routes_per_airline   != null       ? max_routes_per_airline   : null,
  ]);
  return rows[0];
};

// ─── Route discovery ──────────────────────────────────────────────────────────

// Mapping country → region để lọc route hợp lý
// Hãng chỉ khai thác route nếu ít nhất 1 đầu thuộc cùng region
const COUNTRY_REGION = {
  'Vietnam': 'SEA', 'Thailand': 'SEA', 'Singapore': 'SEA',
  'Malaysia': 'SEA', 'Indonesia': 'SEA', 'Philippines': 'SEA',
  'Brunei': 'SEA', 'Laos': 'SEA', 'Cambodia': 'SEA', 'Myanmar': 'SEA',
  'South Korea': 'NEA', 'Japan': 'NEA', 'Taiwan': 'NEA',
  'China': 'NEA', 'Hong Kong': 'NEA', 'Macau': 'NEA', 'Mongolia': 'NEA',
  'Qatar': 'MID', 'UAE': 'MID', 'Turkey': 'MID', 'Saudi Arabia': 'MID',
  'Bahrain': 'MID', 'Oman': 'MID', 'Kuwait': 'MID',
  'United Kingdom': 'EUR', 'Germany': 'EUR', 'France': 'EUR',
  'Netherlands': 'EUR', 'Switzerland': 'EUR', 'Denmark': 'EUR',
  'Spain': 'EUR', 'Austria': 'EUR', 'Finland': 'EUR', 'Belgium': 'EUR',
  'Italy': 'EUR', 'Portugal': 'EUR', 'Ireland': 'EUR', 'Hungary': 'EUR',
  'Norway': 'EUR', 'Sweden': 'EUR', 'Poland': 'EUR',
  'United States': 'NAM', 'Canada': 'NAM',
  'Australia': 'OCE', 'New Zealand': 'OCE',
  'India': 'SAS', 'Sri Lanka': 'SAS', 'Pakistan': 'SAS',
  'Ethiopia': 'AFR', 'Kenya': 'AFR', 'South Africa': 'AFR',
  'Chile': 'SAM', 'Brazil': 'SAM', 'Argentina': 'SAM',
};

const getAutoRoutes = async (maxRoutesPerAirline = 5) => {
  const { rows } = await pool.query(`
    WITH airline_region AS (
      -- Gán region cho mỗi hãng dựa theo country
      SELECT
        al.id          AS airline_id,
        al.code        AS airline_code,
        al.name        AS airline_name,
        al.country     AS airline_country,
        al.price_tier,
        al.is_active
      FROM airlines al
      WHERE al.is_active = TRUE
    ),
    ranked AS (
      SELECT
        ar.airline_id,
        ar.airline_code,
        ar.airline_name,
        ar.airline_country,
        ar.price_tier,
        dep.id   AS dep_id,
        dep.code AS dep_code,
        dep.lat  AS dep_lat,
        dep.lng  AS dep_lng,
        arr.id   AS arr_id,
        arr.code AS arr_code,
        arr.lat  AS arr_lat,
        arr.lng  AS arr_lng,
        ROW_NUMBER() OVER (
          PARTITION BY ar.airline_id
          ORDER BY dep.code, arr.code
        ) AS rn
      FROM airline_region ar
      CROSS JOIN airports dep
      CROSS JOIN airports arr
      WHERE dep.is_active = TRUE
        AND arr.is_active = TRUE
        AND dep.id != arr.id
        AND dep.lat IS NOT NULL AND dep.lng IS NOT NULL
        AND arr.lat IS NOT NULL AND arr.lng IS NOT NULL
        -- Route hợp lệ: ít nhất 1 đầu cùng nước với hãng
        -- Nếu hãng chưa có country → bỏ qua (không tạo route vô căn cứ)
        AND ar.airline_country IS NOT NULL
        AND (
          LOWER(dep.country) = LOWER(ar.airline_country)
          OR LOWER(arr.country) = LOWER(ar.airline_country)
        )
    )
    SELECT airline_id, airline_code, airline_name, airline_country, price_tier,
           dep_id, dep_code, dep_lat, dep_lng,
           arr_id, arr_code, arr_lat, arr_lng
    FROM ranked
    WHERE rn <= $1
    ORDER BY airline_code, dep_code, arr_code
  `, [maxRoutesPerAirline]);
  return rows;
};

// ─── Status ───────────────────────────────────────────────────────────────────

const getStatus = async () => {
  const config = await getConfig();
  const maxRoutes = config?.max_routes_per_airline || 5;
  const routes = await getAutoRoutes(maxRoutes);
  const airlineCounts = {};
  for (const r of routes) {
    airlineCounts[r.airline_code] = (airlineCounts[r.airline_code] || 0) + 1;
  }
  return { config, total_routes: routes.length, airline_counts: airlineCounts };
};

// ─── Batch runner ─────────────────────────────────────────────────────────────

const runBatch = async (batchSize = 20, force = false, unlimited = false) => {
  const config = await getConfig();
  if (!config || (!config.is_enabled && !force)) return { created: 0, skipped: 0, reason: 'disabled' };
  const limit = unlimited ? Infinity : batchSize;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const configStart = config.start_date ? new Date(config.start_date) : today;
  const configEnd   = config.end_date   ? new Date(config.end_date)   : null;
  const advanceCutoff = new Date(today);
  advanceCutoff.setDate(today.getDate() + (config.advance_days || 30));

  const targetEnd = configEnd
    ? new Date(Math.min(configEnd.getTime(), advanceCutoff.getTime()))
    : advanceCutoff;

  if (today > targetEnd) return { created: 0, skipped: 0, reason: 'out_of_range' };

  const maxRoutes = config.max_routes_per_airline || 5;
  const routes = await getAutoRoutes(maxRoutes);
  if (routes.length === 0) return { created: 0, skipped: 0, reason: 'no_routes' };

  const slotsPerRoute = config.flights_per_route || 3;
  const timeSlots     = getTimeSlots(slotsPerRoute);

  // Build mảng ngày từ loopStart → targetEnd
  const loopStart = new Date(Math.max(today.getTime(), configStart.getTime()));
  const dates = [];
  for (let d = new Date(loopStart); d <= targetEnd; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split('T')[0]);
  }
  if (dates.length === 0) return { created: 0, skipped: 0, reason: 'no_dates' };

  const client = await pool.connect();
  try {
    // ── 1 query duy nhất cho toàn bộ range ────────────────────────────────────
    const existingRes = await client.query(`
      SELECT airline_id, departure_airport_id, arrival_airport_id,
             flight_number,
             DATE(departure_time)::text          AS dep_date,
             TO_CHAR(departure_time, 'HH24:MI')  AS dep_slot
      FROM flights
      WHERE DATE(departure_time) >= $1
        AND DATE(departure_time) <= $2
    `, [dates[0], dates[dates.length - 1]]);

    // existingSet: "airlineId_depId_arrId_date_HH:MM"
    const existingSet = new Set(
      existingRes.rows.map(r =>
        `${r.airline_id}_${r.departure_airport_id}_${r.arrival_airport_id}_${r.dep_date}_${r.dep_slot}`
      )
    );

    // usedNums: "date_airlineId" → Set<flight_number>
    const usedNums = {};
    for (const r of existingRes.rows) {
      const key = `${r.dep_date}_${r.airline_id}`;
      if (!usedNums[key]) usedNums[key] = new Set();
      usedNums[key].add(r.flight_number);
    }

    // Group routes by airline
    const airlineRoutes = {};
    for (const route of routes) {
      if (!airlineRoutes[route.airline_id]) airlineRoutes[route.airline_id] = [];
      airlineRoutes[route.airline_id].push(route);
    }

    let created = 0;
    let skipped = 0;

    // ── Loop order: airline → route → slot → ngày ─────────────────────────────
    // Date là vòng trong cùng → mỗi route/slot được tạo cho TẤT CẢ ngày trước
    // khi chuyển sang route/slot tiếp theo → phân bổ đều qua toàn bộ date range
    outer:
    for (const [airlineId, aRoutes] of Object.entries(airlineRoutes)) {
      for (let ri = 0; ri < aRoutes.length; ri++) {
        const route        = aRoutes[ri];
        const km           = haversineKm(Number(route.dep_lat), Number(route.dep_lng), Number(route.arr_lat), Number(route.arr_lng));
        const durationMins = estimateMins(km);
        const tierMult     = Number(route.price_tier) || 1.0;

        for (let si = 0; si < timeSlots.length; si++) {
          const depHour = parseInt(timeSlots[si].slice(0, 2), 10);
          const prices  = calcPrices(durationMins, tierMult, depHour);

          for (const dateStr of dates) {
            if (created >= limit) break outer;

            const depTime = `${dateStr}T${timeSlots[si]}:00`;

            // Bỏ qua slot đã qua hoặc sắp qua trong 2 giờ
            if (new Date(depTime) <= new Date(Date.now() + 2 * 60 * 60 * 1000)) { skipped++; continue; }

            // Kiểm tra đã tồn tại chưa (O(1) lookup)
            const slotKey = `${route.airline_id}_${route.dep_id}_${route.arr_id}_${dateStr}_${timeSlots[si]}`;
            if (existingSet.has(slotKey)) { skipped++; continue; }

            // Tìm flight number chưa dùng cho ngày + hãng này
            const numsKey = `${dateStr}_${airlineId}`;
            if (!usedNums[numsKey]) usedNums[numsKey] = new Set();
            const dateUsed = usedNums[numsKey];
            let flightNum = null;
            const preferredOffset = 100 + ri * slotsPerRoute + si;
            for (let n = preferredOffset; n <= 999; n++) {
              const candidate = `${route.airline_code}${n}`;
              if (!dateUsed.has(candidate)) { flightNum = candidate; dateUsed.add(candidate); break; }
            }
            if (!flightNum) { skipped++; continue; }

            const arrTime = addMins(dateStr, timeSlots[si], durationMins);

            try {
              await client.query('BEGIN');
              const flightRes = await client.query(QF.INSERT_FLIGHT, [
                flightNum, route.airline_id, route.dep_id, route.arr_id,
                depTime, arrTime, durationMins,
              ]);
              const flight = flightRes.rows[0];

              for (const seat of SEAT_CONFIG) {
                const bp = prices[seat.class] || 0;
                await client.query(QF.INSERT_FLIGHT_SEAT, [
                  flight.id, seat.class, seat.total_seats, seat.total_seats,
                  bp, seat.baggage_included_kg, seat.carry_on_kg,
                  autoExtraBagPrice(bp, seat.class),
                ]);
              }

              await client.query('COMMIT');
              existingSet.add(slotKey); // tránh duplicate trong cùng 1 run
              created++;
            } catch (err) {
              await client.query('ROLLBACK');
              console.error(`[AutoFlight] Insert error ${flightNum} ${dateStr}:`, err.message);
              skipped++;
            }
          }
        }
      }
    }

    await pool.query(
      `UPDATE auto_flight_config
       SET last_run_at = NOW(), total_created = total_created + $1
       WHERE id = 1`,
      [created]
    );

    return { created, skipped };
  } finally {
    client.release();
  }
};

module.exports = { getConfig, saveConfig, getStatus, getAutoRoutes, runBatch };
