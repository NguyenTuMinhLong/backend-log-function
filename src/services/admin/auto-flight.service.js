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
  if (cls === 'first' || !Number.isFinite(basePrice) || basePrice <= 0) return 0;
  const ratio = cls === 'business' ? 0.025 : 0.045;
  return Math.max(50000, Math.round(basePrice * ratio / 1000) * 1000);
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

// Cố định 48 slot mỗi 30 phút trong 24 giờ: 00:00, 00:30, ..., 23:30
const getTimeSlots = () => {
  const slots = [];
  for (let m = 0; m < 24 * 60; m += 30) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return slots;
};

// Chọn n slot trải đều từ mảng allSlots (ví dụ: n=3 từ 48 → slot 0, 16, 32)
const selectEvenSlots = (allSlots, n) => {
  const count = Math.min(Math.max(1, n), allSlots.length);
  if (count >= allSlots.length) return [...allSlots];
  const result = [];
  for (let i = 0; i < count; i++) {
    result.push(allSlots[Math.floor(i * allSlots.length / count)]);
  }
  return result;
};

// Format local date thành "YYYY-MM-DD" — tránh lệch ngày do UTC offset
const toLocalDateStr = (d) => {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Tính giờ đến: ghép dateStr + timeStr thành naive local datetime
const addMins = (dateStr, timeStr, durationMins) => {
  // Tạo Date từ chuỗi local (không có Z) để giữ đúng múi giờ server
  const [h, m] = timeStr.split(':').map(Number);
  const [y, mo, dd] = dateStr.split('-').map(Number);
  const dt = new Date(y, mo - 1, dd, h, m, 0, 0);
  dt.setMinutes(dt.getMinutes() + durationMins);
  const pad = n => String(n).padStart(2, '0');
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:00`;
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

const saveConfig = async ({ is_enabled, start_date, end_date, advance_days, route_limit }) => {
  const { rows } = await pool.query(`
    UPDATE auto_flight_config SET
      is_enabled   = COALESCE($1, is_enabled),
      start_date   = COALESCE($2::date, start_date),
      end_date     = COALESCE($3::date, end_date),
      advance_days = COALESCE($4, advance_days),
      route_limit  = COALESCE($5, route_limit)
    WHERE id = 1
    RETURNING *
  `, [
    is_enabled  !== undefined ? is_enabled  : null,
    start_date  || null,
    end_date    || null,
    advance_days != null      ? advance_days : null,
    route_limit  != null      ? route_limit  : null,
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

// offset/limit để phân trang — tránh load hàng trăm nghìn tuyến cùng lúc
// Giới hạn km theo phân khúc hãng (price_tier):
//   < 0.85  → LCC (AirAsia, Vietjet...)        max 6 000 km  (nội địa + khu vực)
//   < 1.30  → Trung cấp (VN Airlines, MAS...)  max 10 000 km (intercontinental vừa)
//   >= 1.30 → Cao cấp (Emirates, SQ, QR...)    max 20 000 km (không giới hạn thực tế)
const ROUTE_MAX_KM_SQL = `
  CASE
    WHEN COALESCE(al.price_tier, 1.0) < 0.85 THEN 6000
    WHEN COALESCE(al.price_tier, 1.0) < 1.30 THEN 10000
    ELSE 20000
  END`;

const HAVERSINE_KM_SQL = `
  6371.0 * 2.0 * ASIN(SQRT(
    POWER(SIN(RADIANS((arr.lat - dep.lat) / 2.0)), 2) +
    COS(RADIANS(dep.lat)) * COS(RADIANS(arr.lat)) *
    POWER(SIN(RADIANS((arr.lng - dep.lng) / 2.0)), 2)
  ))`;

const getAutoRoutes = async (offset = 0, limit = 100) => {
  const { rows } = await pool.query(`
    SELECT
      al.id          AS airline_id,
      al.code        AS airline_code,
      al.name        AS airline_name,
      al.country     AS airline_country,
      al.price_tier,
      dep.id   AS dep_id,
      dep.code AS dep_code,
      dep.lat  AS dep_lat,
      dep.lng  AS dep_lng,
      arr.id   AS arr_id,
      arr.code AS arr_code,
      arr.lat  AS arr_lat,
      arr.lng  AS arr_lng
    FROM airlines al
    CROSS JOIN airports dep
    CROSS JOIN airports arr
    WHERE al.is_active = TRUE
      AND dep.is_active = TRUE
      AND arr.is_active = TRUE
      AND dep.id != arr.id
      AND dep.lat IS NOT NULL AND dep.lng IS NOT NULL
      AND arr.lat IS NOT NULL AND arr.lng IS NOT NULL
      AND al.country IS NOT NULL
      AND (
        LOWER(dep.country) = LOWER(al.country)
        OR LOWER(arr.country) = LOWER(al.country)
      )
      AND ${HAVERSINE_KM_SQL} <= ${ROUTE_MAX_KM_SQL}
    ORDER BY md5(al.id::text || dep.id::text || arr.id::text)
    LIMIT $1 OFFSET $2
  `, [limit, offset]);
  return rows;
};

// Tổng số tuyến — dùng để biết khi nào reset offset về 0
const countAutoRoutes = async () => {
  const { rows } = await pool.query(`
    SELECT COUNT(*) AS total
    FROM airlines al
    CROSS JOIN airports dep
    CROSS JOIN airports arr
    WHERE al.is_active = TRUE
      AND dep.is_active = TRUE
      AND arr.is_active = TRUE
      AND dep.id != arr.id
      AND dep.lat IS NOT NULL AND dep.lng IS NOT NULL
      AND arr.lat IS NOT NULL AND arr.lng IS NOT NULL
      AND al.country IS NOT NULL
      AND (
        LOWER(dep.country) = LOWER(al.country)
        OR LOWER(arr.country) = LOWER(al.country)
      )
      AND ${HAVERSINE_KM_SQL} <= ${ROUTE_MAX_KM_SQL}
  `);
  return parseInt(rows[0].total, 10);
};

// ─── Status ───────────────────────────────────────────────────────────────────

const getStatus = async () => {
  const config      = await getConfig();
  const total       = await countAutoRoutes();
  const offset      = config?.route_offset || 0;
  const routeLimit  = config?.route_limit  || 100;
  return {
    config,
    total_routes:    total,
    current_offset:  offset,
    routes_per_batch: routeLimit,
    batches_to_cover: total > 0 ? Math.ceil(total / routeLimit) : 0,
  };
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

  // Lấy chunk tuyến hiện tại theo offset đã lưu
  const routeLimit  = config.route_limit  || 100;
  const routeOffset = config.route_offset || 0;
  const routes = await getAutoRoutes(routeOffset, routeLimit);
  if (routes.length === 0) {
    // Đã xử lý hết → reset offset về 0 cho chu kỳ tiếp
    await pool.query(`UPDATE auto_flight_config SET route_offset = 0 WHERE id = 1`);
    return { created: 0, skipped: 0, reason: 'cycle_complete_offset_reset' };
  }

  const timeSlots = getTimeSlots(); // 48 slot cố định mỗi 30 phút

  // Build mảng ngày từ loopStart → targetEnd (dùng local date tránh UTC offset)
  const loopStart = new Date(Math.max(today.getTime(), configStart.getTime()));
  const dates = [];
  for (let d = new Date(loopStart); d <= targetEnd; d.setDate(d.getDate() + 1)) {
    dates.push(toLocalDateStr(d));
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

    // Shuffle routes (Fisher-Yates) → phân bổ hãng ngẫu nhiên, không theo alphabet
    for (let i = routes.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [routes[i], routes[j]] = [routes[j], routes[i]];
    }

    let created = 0;
    let skipped = 0;

    const numAirlines      = new Set(routes.map(r => r.airline_id)).size;
    const perAirlineBudget = unlimited ? Infinity : Math.max(3, Math.ceil(limit / numAirlines));
    const airlineCreated   = {}; // { airlineId: count }

    outer:
    for (const route of routes) {
      const { airline_id: airlineId, airline_code } = route;
      if (!airlineCreated[airlineId]) airlineCreated[airlineId] = 0;
      if (!unlimited && airlineCreated[airlineId] >= perAirlineBudget) continue;

      const km           = haversineKm(Number(route.dep_lat), Number(route.dep_lng), Number(route.arr_lat), Number(route.arr_lng));
      const durationMins = estimateMins(km);
      const tierMult     = Number(route.price_tier) || 1.0;

      slots:
      for (let si = 0; si < timeSlots.length; si++) {
        const depHour = parseInt(timeSlots[si].slice(0, 2), 10);
        const prices  = calcPrices(durationMins, tierMult, depHour);

        for (const dateStr of dates) {
          if (created >= limit) break outer;
          if (!unlimited && airlineCreated[airlineId] >= perAirlineBudget) break slots;

          const depTime = `${dateStr}T${timeSlots[si]}:00`;
          if (new Date(depTime) <= new Date(Date.now() + 2 * 60 * 60 * 1000)) { skipped++; continue; }

          const slotKey = `${airlineId}_${route.dep_id}_${route.arr_id}_${dateStr}_${timeSlots[si]}`;
          if (existingSet.has(slotKey)) { skipped++; continue; }

          const numsKey = `${dateStr}_${airlineId}`;
          if (!usedNums[numsKey]) usedNums[numsKey] = new Set();
          const dateUsed = usedNums[numsKey];
          let flightNum = null;
          for (let n = 100; n <= 999; n++) {
            const candidate = `${airline_code}${n}`;
            if (!dateUsed.has(candidate)) { flightNum = candidate; dateUsed.add(candidate); break; }
          }
          if (!flightNum) { skipped++; continue; }

          const arrTime = addMins(dateStr, timeSlots[si], durationMins);

          try {
            await client.query('BEGIN');
            const flightRes = await client.query(QF.INSERT_FLIGHT, [
              flightNum, airlineId, route.dep_id, route.arr_id,
              depTime, arrTime, durationMins,
            ]);
            const flight = flightRes.rows[0];

            for (const seat of SEAT_CONFIG) {
              const raw = prices[seat.class];
              const bp  = Number.isFinite(raw) && raw > 0 ? raw : 0;
              await client.query(QF.INSERT_FLIGHT_SEAT, [
                flight.id, seat.class, seat.total_seats, seat.total_seats,
                bp, seat.baggage_included_kg, seat.carry_on_kg,
                autoExtraBagPrice(bp, seat.class),
              ]);
            }

            await client.query('COMMIT');
            existingSet.add(slotKey);
            created++;
            airlineCreated[airlineId]++;
          } catch (err) {
            await client.query('ROLLBACK');
            console.error(`[AutoFlight] Insert error ${flightNum} ${dateStr}:`, err.message);
            skipped++;
          }
        }
      }
    }

    // Tăng offset cho lần chạy tiếp — nếu vượt tổng số tuyến thì reset về 0
    const totalRoutes   = await countAutoRoutes();
    const nextOffset    = (routeOffset + routeLimit) >= totalRoutes ? 0 : (routeOffset + routeLimit);
    await pool.query(
      `UPDATE auto_flight_config
       SET last_run_at    = NOW(),
           total_created  = total_created + $1,
           route_offset   = $2
       WHERE id = 1`,
      [created, nextOffset]
    );

    return { created, skipped, route_offset: routeOffset, next_offset: nextOffset, total_routes: totalRoutes };
  } finally {
    client.release();
  }
};

// ─── Tạo chuyến bay từ 1 sân bay cụ thể ─────────────────────────────────────
const FROM_AIRPORT_BATCH_LIMIT = 500; // tối đa 500 chuyến/request để tránh timeout

const runFromAirport = async ({ airportCode, arrAirportCode, startDate, endDate, flightsPerRoute, mode }) => {
  // Lấy sân bay nguồn
  const srcRes = await pool.query(
    `SELECT id, code, city, country, lat, lng FROM airports WHERE UPPER(code) = UPPER($1) AND is_active = TRUE`,
    [airportCode]
  );
  if (!srcRes.rows.length) throw new Error(`Sân bay ${airportCode} không tồn tại`);
  const src = srcRes.rows[0];

  // Lấy sân bay đích:
  // - Nếu arrAirportCode được chỉ định → chỉ 1 điểm đến, nhưng tất cả hãng phù hợp đều bay
  // - Nếu không → tất cả sân bay còn lại, xoay vòng hãng theo tuyến
  const destRes = await pool.query(
    `SELECT id, code, name, city, country, lat, lng FROM airports
     WHERE UPPER(code) != UPPER($1) AND is_active = TRUE AND lat IS NOT NULL AND lng IS NOT NULL
     ORDER BY code`,
    [airportCode]
  );
  const destinations = destRes.rows;
  // Shuffle để sân bay được xử lý ngẫu nhiên, không theo alphabet
  for (let i = destinations.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [destinations[i], destinations[j]] = [destinations[j], destinations[i]];
  }

  // Lấy tất cả hãng có country
  const airlineRes = await pool.query(
    `SELECT id, code, name, country, price_tier FROM airlines WHERE is_active = TRUE AND country IS NOT NULL ORDER BY id`
  );
  const allAirlines = airlineRes.rows;
  // Shuffle để hãng được phân bổ ngẫu nhiên (không theo alphabet/id)
  for (let i = allAirlines.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [allAirlines[i], allAirlines[j]] = [allAirlines[j], allAirlines[i]];
  }

  // Build mảng ngày
  const pad = n => String(n).padStart(2, '0');
  const toLocal = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  const dates = [];
  for (let d = new Date(startDate + 'T00:00:00'); toLocal(d) <= endDate; d.setDate(d.getDate()+1)) {
    dates.push(toLocal(d));
  }
  if (!dates.length) throw new Error('Khoảng ngày không hợp lệ');

  const numDays    = dates.length;
  const srcCountry = (src.country || '').toLowerCase();

  // Pre-fetch flight numbers đã dùng — cả chiều đi (dep=src) lẫn chiều về (dep=dest)
  const destIds = destinations.map(d => d.id);
  const usedNumsRes = await pool.query(
    `SELECT al.code AS airline_code, f.departure_airport_id,
            DATE(f.departure_time)::text AS dep_date, f.flight_number
     FROM flights f JOIN airlines al ON al.id = f.airline_id
     WHERE (f.departure_airport_id = $1 OR f.departure_airport_id = ANY($4::int[]))
       AND DATE(f.departure_time) >= $2 AND DATE(f.departure_time) <= $3`,
    [src.id, dates[0], dates[dates.length-1], destIds]
  );
  // usedNums: "${depAirportId}_${dep_date}_${airline_code}" → Set<flight_number>
  const usedNums = {};
  for (const r of usedNumsRes.rows) {
    const key = `${r.departure_airport_id}_${r.dep_date}_${r.airline_code}`;
    if (!usedNums[key]) usedNums[key] = new Set();
    usedNums[key].add(r.flight_number);
  }

  // Pre-fetch slots đã tồn tại — cả 2 chiều liên quan đến src
  const existRes = await pool.query(
    `SELECT airline_id, departure_airport_id, arrival_airport_id,
            DATE(departure_time)::text AS dep_date,
            TO_CHAR(departure_time,'HH24:MI') AS dep_slot
     FROM flights
     WHERE (departure_airport_id = $1 OR arrival_airport_id = $1)
       AND DATE(departure_time) >= $2 AND DATE(departure_time) <= $3`,
    [src.id, dates[0], dates[dates.length-1]]
  );
  const existSet = new Set(
    existRes.rows.map(r => `${r.airline_id}_${r.departure_airport_id}_${r.arrival_airport_id}_${r.dep_date}_${r.dep_slot}`)
  );

  let created = 0, skipped = 0;
  const client = await pool.connect();

  try {
    for (const dest of destinations) {
      if (created >= FROM_AIRPORT_BATCH_LIMIT) break; // dừng sớm — tránh build/lặp thừa gây OOM

      const destCountry = (dest.country || '').toLowerCase();

      // Hãng phù hợp: cùng quốc gia dep/arr VÀ khoảng cách trong tầm bay của hãng
      const km           = haversineKm(Number(src.lat), Number(src.lng), Number(dest.lat), Number(dest.lng));
      const durationMins = estimateMins(km);

      const airlineMaxKm = (al) => {
        const t = Number(al.price_tier) || 1.0;
        return t < 0.85 ? 6000 : t < 1.30 ? 10000 : 20000;
      };
      let compatAirlines = allAirlines.filter(al => {
        const alc = (al.country || '').toLowerCase();
        return (alc === srcCountry || alc === destCountry) && km <= airlineMaxKm(al);
      });
      if (!compatAirlines.length) compatAirlines = allAirlines.filter(al => km <= airlineMaxKm(al));
      if (!compatAirlines.length) compatAirlines = allAirlines;

      // ── Chế độ single route: mỗi hãng bay N chuyến/ngày ─────────────────────
      // ── Chế độ all routes:  xoay vòng hãng qua các slot  ────────────────────
      let schedule = []; // [{ dateStr, slotTime, airlineIdx }]

      // Luôn dùng toàn bộ 48 slot (00:00 → 23:30, mỗi 30 phút)
      const slots = getTimeSlots();
      if (mode === 'all_airlines') {
        // Mỗi slot 1 hãng xoay vòng — 48 chuyến/tuyến/ngày
        let ai = 0;
        for (const dateStr of dates) {
          for (const slotTime of slots) {
            schedule.push({ dateStr, slotTime, airlineIdx: ai++ });
          }
        }
      } else if (mode === 'per_day') {
        let ai = 0;
        for (const dateStr of dates) {
          for (const slotTime of slots) {
            schedule.push({ dateStr, slotTime, airlineIdx: ai++ });
          }
        }
      } else {
        // total: 48 slot/ngày xoay vòng hãng
        let ai = 0;
        for (const dateStr of dates) {
          for (const slotTime of slots) {
            schedule.push({ dateStr, slotTime, airlineIdx: ai++ });
          }
        }
      }

      // Helper tạo 1 chuyến bay (dep→arr)
      const createOne = async (depAirport, arrAirport, airline, dateStr, slotTime, durMins) => {
        if (created >= FROM_AIRPORT_BATCH_LIMIT) { skipped++; return; } // giới hạn batch
        const depTime = `${dateStr}T${slotTime}:00`;
        if (new Date(depTime) <= new Date(Date.now() + 2 * 60 * 60 * 1000)) { skipped++; return; }

        const slotKey = `${airline.id}_${depAirport.id}_${arrAirport.id}_${dateStr}_${slotTime}`;
        if (existSet.has(slotKey)) { skipped++; return; }

        const numsKey = `${depAirport.id}_${dateStr}_${airline.code}`;
        if (!usedNums[numsKey]) usedNums[numsKey] = new Set();
        const dateUsed = usedNums[numsKey];
        let flightNum = null;
        for (let n = 100; n <= 999; n++) {
          const cand = `${airline.code}${n}`;
          if (!dateUsed.has(cand)) { flightNum = cand; dateUsed.add(cand); break; }
        }
        if (!flightNum) { skipped++; return; }

        const depHour = parseInt(slotTime.slice(0, 2), 10);
        const prices  = calcPrices(durMins, Number(airline.price_tier) || 1.0, depHour);
        const arrTime = addMins(dateStr, slotTime, durMins);

        try {
          await client.query('BEGIN');
          const fr = await client.query(QF.INSERT_FLIGHT, [flightNum, airline.id, depAirport.id, arrAirport.id, depTime, arrTime, durMins]);
          const flight = fr.rows[0];
          for (const seat of SEAT_CONFIG) {
            const bp = prices[seat.class] || 0;
            await client.query(QF.INSERT_FLIGHT_SEAT, [
              flight.id, seat.class, seat.total_seats, seat.total_seats,
              bp, seat.baggage_included_kg, seat.carry_on_kg, autoExtraBagPrice(bp, seat.class),
            ]);
          }
          await client.query('COMMIT');
          existSet.add(slotKey);
          created++;
        } catch (err) {
          await client.query('ROLLBACK');
          console.error(`[AirportBatch] Insert error ${flightNum}:`, err.message);
          skipped++;
        }
      };

      // Pass 1: Chiều đi src → dest
      for (const { dateStr, slotTime, airlineIdx } of schedule) {
        if (created >= FROM_AIRPORT_BATCH_LIMIT) break;
        const airline = compatAirlines[airlineIdx % compatAirlines.length];
        await createOne(src, dest, airline, dateStr, slotTime, durationMins);
      }
      if (created >= FROM_AIRPORT_BATCH_LIMIT) break;

      // Pass 2: Chiều về dest → src (hãng phù hợp theo quốc gia dest/src)
      let compatReturn = allAirlines.filter(al => {
        const alc = (al.country || '').toLowerCase();
        return (alc === destCountry || alc === srcCountry) && km <= airlineMaxKm(al);
      });
      if (!compatReturn.length) compatReturn = allAirlines.filter(al => km <= airlineMaxKm(al));
      if (!compatReturn.length) compatReturn = allAirlines;

      // Chiều về — cùng logic 48 slot xoay vòng hãng
      let scheduleReturn = [];
      { let ai = 0;
        for (const dateStr of dates) {
          for (const slotTime of slots) {
            scheduleReturn.push({ dateStr, slotTime, airlineIdx: ai++ });
          }
        }
      }

      for (const { dateStr, slotTime, airlineIdx } of scheduleReturn) {
        const airline = compatReturn[airlineIdx % compatReturn.length];
        await createOne(dest, src, airline, dateStr, slotTime, durationMins);
      }
    }

    return {
      created, skipped,
      destinations: destinations.length,
      airlines: allAirlines.length,
      limit_reached: created >= FROM_AIRPORT_BATCH_LIMIT,
    };
  } finally {
    client.release();
  }
};

module.exports = { getConfig, saveConfig, getStatus, getAutoRoutes, runBatch, runFromAirport };
