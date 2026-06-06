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
    ORDER BY al.code, dep.code, arr.code
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

    // Group routes by airline
    const airlineRoutes = {};
    for (const route of routes) {
      if (!airlineRoutes[route.airline_id]) airlineRoutes[route.airline_id] = [];
      airlineRoutes[route.airline_id].push(route);
    }

    let created = 0;
    let skipped = 0;

    // Chia budget đều cho từng hãng → mỗi batch run tất cả hãng đều được tạo
    const numAirlines      = Object.keys(airlineRoutes).length;
    const perAirlineBudget = unlimited ? Infinity : Math.max(3, Math.ceil(limit / numAirlines));

    outer:
    for (const [airlineId, aRoutes] of Object.entries(airlineRoutes)) {
      let airlineCreated = 0;

      airline:
      for (let ri = 0; ri < aRoutes.length; ri++) {
        const route        = aRoutes[ri];
        const km           = haversineKm(Number(route.dep_lat), Number(route.dep_lng), Number(route.arr_lat), Number(route.arr_lng));
        const durationMins = estimateMins(km);
        const tierMult     = Number(route.price_tier) || 1.0;

        for (let si = 0; si < timeSlots.length; si++) {
          const depHour = parseInt(timeSlots[si].slice(0, 2), 10);
          const prices  = calcPrices(durationMins, tierMult, depHour);

          for (const dateStr of dates) {
            if (created >= limit)                      break outer;   // hết tổng quota → dừng hẳn
            if (airlineCreated >= perAirlineBudget)    break airline; // hết budget hãng này → qua hãng tiếp

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
            const preferredOffset = 100 + ri * timeSlots.length + si;
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
              airlineCreated++;
            } catch (err) {
              await client.query('ROLLBACK');
              console.error(`[AutoFlight] Insert error ${flightNum} ${dateStr}:`, err.message);
              skipped++;
            }
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

  // Lấy tất cả hãng có country
  const airlineRes = await pool.query(
    `SELECT id, code, name, country, price_tier FROM airlines WHERE is_active = TRUE AND country IS NOT NULL ORDER BY id`
  );
  const allAirlines = airlineRes.rows;

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
      const destCountry = (dest.country || '').toLowerCase();

      // Hãng phù hợp: hãng cùng nước với điểm đến HOẶC hãng cùng nước dep (VN)
      let compatAirlines = allAirlines.filter(al => {
        const alc = (al.country || '').toLowerCase();
        return alc === srcCountry || alc === destCountry;
      });
      if (!compatAirlines.length) compatAirlines = allAirlines;

      const km           = haversineKm(Number(src.lat), Number(src.lng), Number(dest.lat), Number(dest.lng));
      const durationMins = estimateMins(km);

      // ── Chế độ single route: mỗi hãng bay N chuyến/ngày ─────────────────────
      // ── Chế độ all routes:  xoay vòng hãng qua các slot  ────────────────────
      let schedule = []; // [{ dateStr, slotTime, airlineIdx }]

      const slots = getTimeSlots(); // 48 slot cố định mỗi 30 phút
      if (mode === 'all_airlines') {
        // Tất cả hãng phù hợp đều bay tuyến này, mỗi hãng 48 chuyến/ngày
        for (const dateStr of dates) {
          for (let ai = 0; ai < compatAirlines.length; ai++) {
            for (let si = 0; si < slots.length; si++) {
              schedule.push({ dateStr, slotTime: slots[si], airlineIdx: ai });
            }
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
        // total: phân bổ đều 48 slot/ngày qua các ngày
        let ai = 0;
        for (const dateStr of dates) {
          for (const slotTime of slots) {
            schedule.push({ dateStr, slotTime, airlineIdx: ai++ });
          }
        }
      }

      // Helper tạo 1 chuyến bay (dep→arr)
      const createOne = async (depAirport, arrAirport, airline, dateStr, slotTime, durMins) => {
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
        const airline = compatAirlines[airlineIdx % compatAirlines.length];
        await createOne(src, dest, airline, dateStr, slotTime, durationMins);
      }

      // Pass 2: Chiều về dest → src (hãng phù hợp theo quốc gia dest/src)
      let compatReturn = allAirlines.filter(al => {
        const alc = (al.country || '').toLowerCase();
        return alc === destCountry || alc === srcCountry;
      });
      if (!compatReturn.length) compatReturn = allAirlines;

      let scheduleReturn = [];
      if (mode === 'all_airlines') {
        for (const dateStr of dates) {
          for (let ai = 0; ai < compatReturn.length; ai++) {
            for (let si = 0; si < slots.length; si++) {
              scheduleReturn.push({ dateStr, slotTime: slots[si], airlineIdx: ai });
            }
          }
        }
      } else {
        let ai = 0;
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

    return { created, skipped, destinations: destinations.length, airlines: allAirlines.length };
  } finally {
    client.release();
  }
};

module.exports = { getConfig, saveConfig, getStatus, getAutoRoutes, runBatch, runFromAirport };
