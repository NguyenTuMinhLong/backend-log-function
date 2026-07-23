"use strict";

/**
 * Recommendation Service — CU-05
 * GET /api/flights/recommendations → recommendationService.getRecommendations()
 *
 * Gộp từ 2 service cũ:
 *   - recommendationService.getRecommendations()  (5 luồng: user history, day pattern,
 *     time proximity, search history, popular)
 *   - flightService.recommendFlights()             (scored flights + badges + filters)
 *
 * Logic ưu tiên:
 *   Tier 1: User booking history → flights phù hợp route/ngày/giờ
 *   Tier 2: User search history → flights theo tuyến hay tìm
 *   Tier 3: Popular flights     → fallback cuối cùng
 *   Time Proximity groups        → xen kẽ giữa các tier
 */

const pool = require("../config/db");
const Q = require("../queries/recommendation.queries");
const { applyDynamicPricingWithSeason } = require("../utils/pricing");
const { generatePriceAlert } = require("./price-alert.service");

// ── Cache constants ────────────────────────────────────────────────────────────
const CACHE_TTL_MINUTES = 10;

const CACHE_QUERIES = {
  FIND: `
    SELECT payload, expires_at
    FROM recommendation_cache
    WHERE cache_key = $1
      AND expires_at > NOW()
      AND (user_id = $2::bigint OR session_id = $3)
    LIMIT 1
  `,
  UPSERT: `
    INSERT INTO recommendation_cache
      (user_id, session_id, cache_key, payload, expires_at)
    VALUES ($1::bigint, $2, $3, $4, NOW() + INTERVAL '${CACHE_TTL_MINUTES} minutes')
    ON CONFLICT DO NOTHING
  `,
};

const buildCacheKey = ({ fromAirport, toAirport, filter, limit }) => {
  return `rec_v2_${fromAirport || "any"}_${toAirport || "any"}_${filter || "default"}_${limit || 10}`;
};

// ── Cache helpers ──────────────────────────────────────────────────────────────
const getCached = async (userId, sessionId, cacheKey) => {
  if (!cacheKey) return null;
  try {
    const result = await pool.query(CACHE_QUERIES.FIND, [
      cacheKey,
      userId || null,
      sessionId || null,
    ]);
    if (result.rows.length > 0) {
      console.log(`[Recommendation Cache] HIT — key: ${cacheKey}`);
      return result.rows[0].payload;
    }
    console.log(`[Recommendation Cache] MISS — key: ${cacheKey}`);
    return null;
  } catch (err) {
    console.error("[Recommendation Cache] lookup error:", err.message);
    return null;
  }
};

const setCached = async (userId, sessionId, cacheKey, payload) => {
  if (!cacheKey) return;
  try {
    await pool.query(CACHE_QUERIES.UPSERT, [
      userId || null,
      sessionId || null,
      cacheKey,
      JSON.stringify(payload),
    ]);
    console.log(`[Recommendation Cache] WRITTEN — key: ${cacheKey}, TTL: ${CACHE_TTL_MINUTES}m`);
  } catch (err) {
    console.error("[Recommendation Cache] write error:", err.message);
  }
};

const BADGE = {
  DAY_PATTERN:      { label: "📅 Ngày bạn hay đặt",  color: "blue" },
  TIME_PROXIMITY:   { label: "⏰ Nhiều chuyến gần giờ", color: "purple" },
  USER_HISTORY:     { label: "⭐ Yêu thích của bạn", color: "yellow" },
  POPULAR:          { label: "🔥 Tuyến hot",           color: "orange" },
  SEARCHED:         { label: "🔍 Đang trending",       color: "teal" },
};

const DOW_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

// Helper: chuyển giờ UTC trong timestamp string → giờ Việt Nam (UTC+7)
// departure_time được pg driver trả về dạng ISO UTC string
const getLocalHour = (utcString) => {
  const d = new Date(utcString);
  return (d.getUTCHours() + 7) % 24;
};

const getVietnamDate = (utcString) => {
  const d = new Date(utcString);
  return new Date(d.getTime() + 7 * 60 * 60 * 1000);
};

// Helper: lấy ngày trong tháng theo giờ VN
const getLocalDay = (utcString) => {
  return getVietnamDate(utcString).getUTCDate();
};

// Helper: lấy day-of-week theo giờ VN (0=CN, 1=T2, ..., 6=T7)
const getLocalDOW = (utcString) => {
  return getVietnamDate(utcString).getUTCDay();
};

const formatDOW = (dow) => DOW_NAMES[parseInt(dow, 10)] || `T${dow}`;

const formatDuration = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

const buildBaggageOptions = (extraBaggagePrice) => {
  const pricePerKg = parseFloat(extraBaggagePrice) || 0;
  return [
    { kg: 0,  label: "No extra", price_per_person: 0 },
    { kg: 5,  label: "+5 kg",     price_per_person: 5  * pricePerKg },
    { kg: 10, label: "+10 kg",    price_per_person: 10 * pricePerKg },
    { kg: 15, label: "+15 kg",    price_per_person: 15 * pricePerKg },
    { kg: 20, label: "+20 kg",    price_per_person: 20 * pricePerKg },
  ];
};

/**
 * formatFlight — dùng chung cho cả scored flights và recommendation flights
 * Khi có r.score → dùng format scoring (from SELECT_SCORED_FLIGHTS)
 * Khi không có r.score → dùng format recommendation (from SELECT_*_FLIGHTS)
 *
 * Giá phải tính qua applyDynamicPricingWithSeason (mùa/ngày/nhu cầu) — giống
 * flight.service.js/formatFlights — chứ không chỉ nhân r.holiday_multiplier,
 * nếu không giá ở Recommendations/RecommendationBar sẽ lệch với giá ở trang tìm kiếm.
 */
const formatFlight = async (r, adults = 1, children = 0, infants = 0) => {
  const base = parseFloat(r.base_price) || 0;
  const extraPrice = parseFloat(r.extra_baggage_price) || 0;
  const adjusted = await applyDynamicPricingWithSeason(
    base, r.available_seats, r.total_seats, r.departure_time,
  );
  const multiplier = base > 0 ? adjusted / base : 1;

  // Lý do giá tăng/giảm (mùa cao điểm, lễ...) — giống flight.service.js.
  // Trước đây recommendations không trả price_alert nên trang chủ không hiển thị
  // được tag giải thích vì sao giá thay đổi. Locale cố định 'vi' vì response
  // được cache chung (cacheKey không phân biệt ngôn ngữ).
  let priceAlert = null;
  try {
    priceAlert = await generatePriceAlert({
      id: r.id,
      departure_time: r.departure_time,
      base_price: base,
      available_seats: r.available_seats,
      total_seats: r.total_seats,
    }, null, null, 'vi');
  } catch { /* thiếu price_alert không được phép làm hỏng recommendations */ }

  return {
    // Trường dùng chung
    id: r.id,
    flight_number: r.flight_number,
    departure_time: r.departure_time,
    arrival_time: r.arrival_time,
    duration_minutes: r.duration_minutes,
    duration_label: formatDuration(r.duration_minutes),
    status: r.status,
    airline: {
      id: r.airline_id,
      code: r.airline_code,
      name: r.airline_name,
      logo_url: r.airline_logo || null,
      logo_dark: r.airline_logo_dark || null,
      logo_light: r.airline_logo_light || null,
    },
    departure: {
      airport_id: r.departure_airport_id,
      code: r.departure_code,
      city: r.departure_city,
      name: r.departure_airport_name,
    },
    arrival: {
      airport_id: r.arrival_airport_id,
      code: r.arrival_code,
      city: r.arrival_city,
      name: r.arrival_airport_name,
    },
    seat: {
      class: r.seat_class || "economy",
      available_seats: r.available_seats,
      total_seats: r.total_seats,
      base_price: base,
      price_multiplier: multiplier,
      adjusted_price: Math.round(adjusted),
      baggage_included_kg: r.baggage_included_kg,
      carry_on_kg: r.carry_on_kg,
      extra_baggage_price: extraPrice,
      extra_baggage_options: buildBaggageOptions(extraPrice),
      price_breakdown: {
        adult_price:  Math.round(adjusted),
        child_price:  Math.round(adjusted * 0.75),
        infant_price: Math.round(adjusted * 0.1),
      },
      total_price: Math.round(
        adjusted * adults + adjusted * 0.75 * children + adjusted * 0.1 * infants,
      ),
    },
    holiday: r.holiday_id
      ? { id: r.holiday_id, name: r.holiday_name, multiplier }
      : null,
    price_alert: priceAlert,
  };
};

const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
};

const getNextMonthRange = (date = new Date()) => {
  const year = date.getFullYear();
  const month = date.getMonth() + 2;
  return getMonthRange(year + Math.floor((month - 1) / 12), ((month - 1) % 12) + 1);
};

const hasUpcomingPatternDate = (dates, now = new Date()) => {
  const today = now.toISOString().split("T")[0];
  return dates.some((dateValue) => dateValue >= today);
};

const getRecommendations = async ({
  userId,
  sessionId,
  fromAirport   = null,
  toAirport     = null,
  limit         = 10,
  filter        = null,   // 'cheapest' | 'early_month' | null
}) => {
  const now = new Date();
  const currentYear  = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const monthRange   = getMonthRange(currentYear, currentMonth);

  const cacheKey = buildCacheKey({ fromAirport, toAirport, filter, limit });
  const cached   = await getCached(userId, sessionId, cacheKey);
  if (cached) return cached;

  console.log("[Recommendation] Start — userId:", userId,
    "from:", fromAirport, "→", toAirport,
    "filter:", filter, "limit:", limit);

  // ── Bước 1: Phân tích user preferences từ lịch sử ──────────────────────────
  let hasSearchHistory   = false;
  let hasBookingHistory  = false;
  let hasHistory         = false;
  let preferredHours     = null;
  let avgSpending        = null;
  let preferredDay       = 0;
  let preferredWeekOfMonth = null;
  let preferredDOW       = null;
  let preferredDestinations = [];
  let preferredDepartures = [];
  let preferredRoutes     = [];

  // 1a. Lịch sử tìm kiếm (user hoặc guest session)
  if (userId || sessionId) {
    const isUser = !!userId;
    const safeUserId = isUser ? parseInt(userId) : null;
    console.log(`[Recommendation] Step 1a — isUser: ${isUser}, safeUserId: ${safeUserId}, sessionId: ${sessionId}`);

    const searchResult = await pool.query(
      isUser ? Q.SELECT_SEARCH_HISTORY_BY_USER : Q.SELECT_SEARCH_HISTORY_BY_SESSION,
      isUser ? [safeUserId] : [sessionId],
    ).catch((err) => {
      console.error("[Recommendation] Step 1a search history query ERROR:", err.message);
      return { rows: [] };
    });

    if (searchResult.rows.length > 0) {
      hasSearchHistory        = true;
      hasHistory              = true;
      preferredDestinations   = searchResult.rows.map((r) => r.arrival_code);
      preferredDepartures     = searchResult.rows.map((r) => r.departure_code);
      avgSpending             = parseFloat(searchResult.rows[0].avg_min_price) || null;
    }
    console.log("[Recommendation] Step 1a — searchHistory rows:", searchResult.rows.length,
      "→ preferredDestinations:", preferredDestinations, "preferredDepartures:", preferredDepartures);

    // 1b. Lịch sử booking — lấy sở thích giờ, ngày, điểm đến
    if (userId) {
      const safeBookingUserId = parseInt(userId);
      if (isNaN(safeBookingUserId)) {
        console.warn("[Recommendation] Step 1b — userId is invalid, skipping booking history:", userId);
      } else {
        const bookingResult = await pool.query(
          Q.SELECT_BOOKING_HISTORY_PREFERENCES,
          [safeBookingUserId],
        ).catch((err) => {
          console.error("[Recommendation] Step 1b booking history query ERROR:", err.message);
          return { rows: [] };
        });
        console.log("[Recommendation] Step 1b — bookingHistory rows:", bookingResult.rows.length,
          bookingResult.rows.length > 0
            ? bookingResult.rows.map(r => ({
              route: r.route_key,
              hour: r.avg_dep_hour,
              day: r.preferred_day,
              week: r.preferred_week_of_month,
              dow: r.preferred_dow,
            }))
            : "(no data)");

        if (bookingResult.rows.length > 0) {
          hasBookingHistory = true;
          hasHistory        = true;
          preferredHours    = parseFloat(bookingResult.rows[0].avg_dep_hour) || null;
          avgSpending       = parseFloat(bookingResult.rows[0].avg_price) || avgSpending;
          preferredDay      = parseFloat(bookingResult.rows[0].preferred_day) || 0;
          preferredWeekOfMonth = parseInt(bookingResult.rows[0].preferred_week_of_month, 10) || null;
          const rawDOW      = Number(bookingResult.rows[0].preferred_dow);
          preferredDOW     = Number.isFinite(rawDOW) ? Math.round(rawDOW) : null;

          for (const r of bookingResult.rows) {
            if (!preferredDestinations.includes(r.arr_code)) {
              preferredDestinations.push(r.arr_code);
            }
            if (!preferredDepartures.includes(r.dep_code)) {
              preferredDepartures.push(r.dep_code);
            }
          }
          preferredRoutes = bookingResult.rows.map(r => r.route_key);
        }
      }
    }
  }

  // 1c. Fallback TopBuy khi preferredDestinations hoàn toàn trống
  // ⚠️ KHÔNG ghi đè nếu đã có preferredDestinations từ search history
  if (preferredDestinations.length === 0) {
    const topBuy = await pool.query(Q.SELECT_TOP_BUY_DESTINATIONS)
      .catch(() => ({ rows: [] }));
    preferredDestinations = topBuy.rows.map((r) => r.arr_code);
    console.log("[Recommendation] Step 1c — topBuy fallback (no history):", preferredDestinations);
  } else {
    console.log("[Recommendation] Step 1c — SKIP topBuy, preferredDestinations:", preferredDestinations);
  }

  console.log("[Recommendation] Step 1 — hasHistory:", hasHistory,
    "hasSearchHistory:", hasSearchHistory,
    "hasBookingHistory:", hasBookingHistory,
    "preferredRoutes:", preferredRoutes,
    "preferredHours:", preferredHours,
    "preferredDay:", preferredDay,
    "preferredWeekOfMonth:", preferredWeekOfMonth,
    "preferredDOW:", preferredDOW);

  // ── Bước 2: Scored flights (from recommendFlights) ──────────────────────────
  const extraOrder   = filter === "cheapest" ? "fs.base_price ASC," : "";
  const extraFilter = filter === "early_month"
    ? "AND EXTRACT(DAY FROM f.departure_time) BETWEEN 1 AND 7" : "";

  const scoredQuery = Q.SELECT_SCORED_FLIGHTS(extraOrder, extraFilter, fromAirport, toAirport, preferredRoutes);

  // User chưa có lịch sử (hasHistory=false) → lấy nhiều ứng viên hơn để đa dạng hoá
  // tuyến ở bước dưới, tránh tình trạng toàn bộ gợi ý đều cùng 1 tuyến (vd SGN→HAN).
  const queryLimit = hasHistory ? limit : limit * 5;

  const scoredResult = await pool.query(scoredQuery, [
    queryLimit,
    preferredDestinations.length > 0 ? preferredDestinations : [""],
    preferredDepartures.length > 0 ? preferredDepartures : [""],
    avgSpending || 0,
    preferredDay > 0 ? [preferredDay] : [],
    preferredRoutes,
    preferredDOW !== null ? [preferredDOW] : [],
    preferredHours !== null ? [preferredHours] : [],
    fromAirport || null,
    toAirport   || null,
  ]).catch((err) => {
    console.error("[Recommendation] Step 2 query error:", err.message);
    console.error("[Recommendation] Step 2 query text:", scoredQuery.substring(0, 200));
    console.error("[Recommendation] Step 2 params:", limit, preferredDestinations, preferredDepartures, avgSpending, preferredDay, preferredRoutes, preferredDOW, preferredHours, fromAirport, toAirport);
    return { rows: [] };
  });

  console.log("[Recommendation] Step 2 — scoredResult rows:", scoredResult.rows.length,
    "preferredDOW:", preferredDOW,
    "preferredRoutes:", preferredRoutes);

  let scoredFlights = await Promise.all(scoredResult.rows.map(async (r, i) => {
    const f = await formatFlight(r);
    const score = parseInt(r.score, 10) || 0;
    const hour  = getLocalHour(f.departure_time);
    const day   = getLocalDay(f.departure_time);
    const badges = [];

    if (preferredDestinations.includes(f.arrival.code)) {
      badges.push(hasHistory
        ? { label: "Điểm đến yêu thích", color: "blue" }
        : { label: "Tuyến hot",             color: "orange" });
    }
    if (preferredHours !== null && Math.abs(hour - preferredHours) <= 2)
      badges.push({ label: `Khung giờ hay đi (${Math.round(preferredHours)}h)`, color: "purple" });
    else if (hour >= 5 && hour <= 11)
      badges.push({ label: "Chuyến sáng", color: "yellow" });
    if (f.duration_minutes < 300)
      badges.push({ label: "Bay thẳng", color: "green" });
    if (f.seat && f.seat.base_price < 5000000)
      badges.push({ label: "Giá tốt < 5tr", color: "green" });
    if (filter === "cheapest")
      badges.push({ label: "Giá rẻ nhất", color: "red" });
    if (preferredDay > 0 && Math.abs(day - preferredDay) <= 1)
      badges.push({ label: `Ngày bạn hay đi (mùng ${preferredDay})`, color: "pink" });
    else if (day >= 1 && day <= 7)
      badges.push({ label: "Đầu tháng", color: "teal" });

    if (preferredDOW !== null) {
      const dowFlight = getLocalDOW(f.departure_time);
      if (dowFlight === preferredDOW) {
        badges.push({ label: `Thứ ${DOW_NAMES[preferredDOW]} bạn hay đi`, color: "orange" });
      }
    }

    return {
      ...f,
      score,
      badges,
      is_recommended:        score > 20,
      recommendation_type:   hasHistory ? "personalized" : "top_buy",
      recommendation_reason: hasHistory ? "personalized" : "top_buy",
      filter_applied:        filter || "default",
    };
  }));

  console.log("[Recommendation] Step 2 — scoredFlights:", scoredFlights.length);

  // ── Bước 2a: Đa dạng hoá tuyến cho user chưa có lịch sử ─────────────────────
  // Không để 1 tuyến (vd SGN→HAN) chiếm hết danh sách gợi ý — lấy round-robin
  // mỗi tuyến 1 chuyến trước, dư slot mới lấy chuyến thứ 2 của từng tuyến...
  if (!hasHistory && scoredFlights.length > limit) {
    const byRoute = new Map();
    scoredFlights.forEach((f) => {
      const key = `${f.departure.code}→${f.arrival.code}`;
      if (!byRoute.has(key)) byRoute.set(key, []);
      byRoute.get(key).push(f);
    });
    const routeGroups = Array.from(byRoute.values());
    const diversified = [];
    for (let i = 0; diversified.length < limit && routeGroups.some((g) => g[i]); i++) {
      for (const g of routeGroups) {
        if (g[i]) diversified.push(g[i]);
        if (diversified.length >= limit) break;
      }
    }
    console.log("[Recommendation] Step 2a — diversified routes:", byRoute.size,
      "→ scoredFlights:", scoredFlights.length, "→", diversified.length);
    scoredFlights = diversified;
  }

  // Gán _tier cho scoredFlights trước khi gom nhóm
  const TIER_FLIGHT = hasHistory ? 0 : 3; // user_history=0 hoặc popular=3
  scoredFlights.forEach((f) => { f._tier = TIER_FLIGHT; });

  // ── Bước 2b: Fallback sớm khi không tìm được flights theo preferences ───
  // Nếu scoredFlights rỗng mà có preferredDestinations → chuyến bay khớp preferences không tồn tại
  // → Lấy top popular flights để đảm bảo luôn có kết quả
  if (scoredFlights.length === 0 && preferredDestinations.length > 0) {
    try {
      const { start, end } = monthRange;
      const popularResult = await pool.query(
        Q.SELECT_TOP_POPULAR_FLIGHTS(start, end, limit, preferredDestinations),
        [start, end, limit, preferredDestinations],
      );
      if (popularResult.rows.length > 0) {
        scoredFlights = await Promise.all(popularResult.rows.map(async (r) => {
          const f = await formatFlight(r);
          return {
            ...f,
            score:               0,
            badges:              [{ label: "Tuyến phổ biến", color: "orange" }],
            recommendation_type: "popular",
            badge:               BADGE.POPULAR,
            is_recommended:      false,
            recommendation_reason: "popular",
            filter_applied:      filter || "default",
            _tier:               3,
          };
        }));
        scoredFlights.forEach((f) => { f._tier = 3; });
        console.log("[Recommendation] Step 2b — used popular fallback (no scored flights), rows:", scoredFlights.length);
      }
    } catch (err) {
      console.error("[Recommendation] Step 2b fallback error:", err.message);
    }
  }

  // ── Bước 3: Recommendation groups (time proximity, day pattern) ──────────────
  // 3a. Day pattern
  let dayPatternFlights = [];
  if (hasHistory && preferredDOW !== null) {
    try {
      let patternMonthRange = monthRange;
      let dayResult = await pool.query(Q.SELECT_DAYS_IN_MONTH, [
        patternMonthRange.start,
        preferredDOW,
        preferredWeekOfMonth,
      ]);
      let dates = dayResult.rows.map((r) => r.date_value);

      if (dates.length === 0 || !hasUpcomingPatternDate(dates)) {
        patternMonthRange = getNextMonthRange(now);
        dayResult = await pool.query(Q.SELECT_DAYS_IN_MONTH, [
          patternMonthRange.start,
          preferredDOW,
          preferredWeekOfMonth,
        ]);
        dates = dayResult.rows.map((r) => r.date_value);
      }

      if (dates.length > 0) {
        const flightsResult = await pool.query(
          Q.SELECT_FLIGHTS_BY_DAY_PATTERN(preferredRoutes, preferredDestinations, preferredDepartures),
          [dates, limit, preferredDepartures, preferredDestinations, preferredRoutes],
        );
        dayPatternFlights = await Promise.all(flightsResult.rows.map(async (r) => {
          const f = await formatFlight(r);
          // Tính score động: địa điểm×5 + ngày×3 + giờ×2 (theo spec Luồng 3)
          const destScore   = preferredDestinations.includes(f.arrival.code) ? 5 : 0;
          const dayScore    = 40;
          const hourScore   = (preferredHours !== null)
            ? (Math.abs(getLocalHour(f.departure_time) - preferredHours) <= 2 ? 2 : 0)
            : 0;
          const score = destScore + dayScore + hourScore;

          return {
            ...f,
            score,
            badges: [
              {
                label: `${DOW_NAMES[preferredDOW]} tuần ${preferredWeekOfMonth || "ưa thích"} trong tháng`,
                color: "blue",
              },
              ...(destScore > 0 ? [{ label: "Điểm đến yêu thích", color: "blue" }] : []),
              ...(hourScore > 0 ? [{ label: `Khung giờ hay đi`, color: "purple" }] : []),
            ],
            recommendation_type: "day_pattern",
            badge: BADGE.DAY_PATTERN,
            note: `${DOW_NAMES[preferredDOW]} tuần ${preferredWeekOfMonth || "ưa thích"} trong tháng`,
            _tier: -1,
          };
        }));
      }
    } catch (err) {
      console.error("[Recommendation] Step 3a error:", err.message);
    }
  }

  // 3b. Time proximity groups
  let timeProximityGroups = [];
  try {
    const { start, end } = monthRange;
    const result = await pool.query(
      Q.SELECT_FLIGHTS_FOR_TIME_GROUPING(preferredRoutes, preferredDestinations, preferredDepartures),
      [start, end, limit, preferredRoutes, preferredDestinations, preferredDepartures],
    );

    if (result.rows.length > 0) {
      const formatted = await Promise.all(result.rows.map((r) => formatFlight(r)));
      const routeGroups = {};

      formatted.forEach((f) => {
        const key = `${f.departure.code}→${f.arrival.code}`;
        if (!routeGroups[key]) routeGroups[key] = [];
        routeGroups[key].push(f);
      });

      Object.entries(routeGroups).forEach(([, flights]) => {
        const sorted = [...flights].sort(
          (a, b) => new Date(a.departure_time) - new Date(b.departure_time),
        );

        let currentGroup = [sorted[0]];
        let groupId = 1;

        for (let i = 1; i < sorted.length; i++) {
          const diffMin =
            (new Date(sorted[i].departure_time) - new Date(sorted[i - 1].departure_time)) / 60000;
          if (diffMin <= 30) {
            currentGroup.push(sorted[i]);
          } else {
            if (currentGroup.length > 0) {
              timeProximityGroups.push({
                group_id: groupId++,
                route: `${currentGroup[0].departure.code}→${currentGroup[0].arrival.code}`,
                count: currentGroup.length,
                flights: currentGroup,
                badge: currentGroup.length > 1 ? BADGE.TIME_PROXIMITY : null,
                score: currentGroup.length > 1 ? 30 - groupId * 2 : 5,
                recommendation_type: "time_proximity",
              });
            }
            currentGroup = [sorted[i]];
          }
        }

        if (currentGroup.length > 0) {
          timeProximityGroups.push({
            group_id: groupId,
            route: `${currentGroup[0].departure.code}→${currentGroup[0].arrival.code}`,
            count: currentGroup.length,
            flights: currentGroup,
            badge: currentGroup.length > 1 ? BADGE.TIME_PROXIMITY : null,
            score: currentGroup.length > 1 ? 30 - groupId * 2 : 5,
            recommendation_type: "time_proximity",
          });
        }
      });
    }
  } catch (err) {
    console.error("[Recommendation] Step 3b error:", err.message);
  }

  console.log("[Recommendation] Step 3 — dayPatternFlights:", dayPatternFlights.length,
    "timeProximityGroups:", timeProximityGroups.length);

  // ── Bước 3c: Luồng 3 — pattern cá nhân (địa điểm×5 + ngày×3 + giờ×2)
  let userPatternFlights = [];
  if (hasHistory && (preferredDestinations.length > 0 || preferredDepartures.length > 0)) {
    try {
      const { start, end } = monthRange;
      const preferredDOWs   = preferredDOW !== null ? [preferredDOW] : [];
      const preferredHoursArr = preferredHours !== null ? [Math.floor(preferredHours)] : [];

      const patternResult = await pool.query(
        Q.SELECT_FLIGHTS_BY_USER_PATTERN(
          preferredDestinations,
          preferredDepartures,
          preferredDOWs,
          preferredHoursArr,
          start,
          end,
          limit,
        ),
        [
          preferredDestinations.length > 0 ? preferredDestinations : [""],
          preferredDepartures.length > 0 ? preferredDepartures : [""],
          preferredDOWs,
          preferredHoursArr,
          start,
          end,
          limit,
        ],
      );

      if (patternResult.rows.length > 0) {
        userPatternFlights = await Promise.all(patternResult.rows.map(async (r) => {
          const f = await formatFlight(r);
          return {
            ...f,
            score:   parseInt(r.score, 10) || 0,
            badges:  [],
            recommendation_type: "user_pattern",
            badge:   BADGE.USER_HISTORY,
            note:    "Phù hợp sở thích cá nhân",
            _tier:   0,
          };
        }));
      }
      console.log("[Recommendation] Step 3c — userPatternFlights:", userPatternFlights.length);
    } catch (err) {
      console.error("[Recommendation] Step 3c error:", err.message);
    }
  }

  // ── Bước 4: Gom nhóm và trộn theo tier ──────────────────────────────────────
  const TIER   = { user_history: 0, day_pattern: 1, search_history: 2, popular: 3, time_proximity: 4 };

  // 4a. Nhóm personalized / popular (từ scoredFlights theo route)
  const routeFlightMap = {};
  scoredFlights.forEach((f) => {
    const key = `${f.departure.code}→${f.arrival.code}`;
    if (!routeFlightMap[key]) routeFlightMap[key] = [];
    routeFlightMap[key].push(f);
  });
  const personalizedGroups = Object.entries(routeFlightMap).map(([route, flights], i) => ({
    group_id:            i + 1,
    route,
    count:               flights.length,
    flights,
    badge:               null,
    score:               flights[0]?.score || 0,
    recommendation_type: hasHistory ? "user_history" : "popular",
    _tier:               hasHistory ? 0 : 3,
  }));

  // 4b. Nhóm user_pattern (Luồng 3) — tier 0, xen kẽ với personalized
  const userPatternRouteMap = {};
  userPatternFlights.forEach((f) => {
    const key = `${f.departure.code}→${f.arrival.code}`;
    if (!userPatternRouteMap[key]) userPatternRouteMap[key] = [];
    userPatternRouteMap[key].push(f);
  });
  const userPatternGroups = Object.entries(userPatternRouteMap).map(([route, flights], i) => ({
    group_id:            personalizedGroups.length + i + 1,
    route,
    count:               flights.length,
    flights,
    badge:               flights.length > 0 ? BADGE.USER_HISTORY : null,
    score:               flights.reduce((max, f) => Math.max(max, f.score || 0), 0),
    recommendation_type: "user_pattern",
    _tier:               0,
  }));

  // 4c. Nhóm day_pattern theo route (Fix E+F: badge đúng, score động từ flights)
  const dayPatternRouteMap = {};
  dayPatternFlights.forEach((f) => {
    const key = `${f.departure.code}→${f.arrival.code}`;
    if (!dayPatternRouteMap[key]) dayPatternRouteMap[key] = [];
    dayPatternRouteMap[key].push(f);
  });
  const dayPatternGroups = Object.entries(dayPatternRouteMap).map(([route, flights], i) => ({
    group_id:            personalizedGroups.length + userPatternGroups.length + i + 1,
    route,
    count:               flights.length,
    flights,
    badge:               flights.length > 0 ? BADGE.DAY_PATTERN : null,
    score:               flights.reduce((max, f) => Math.max(max, f.score || 0), 0),
    recommendation_type: "day_pattern",
    _tier:               -1,
  }));

  // 4d. Gán group_id liên tục và _tier=4 cho time_proximity
  let nextGroupId = personalizedGroups.length + userPatternGroups.length + dayPatternGroups.length + 1;
  const tpGroups = timeProximityGroups.map((g) => ({
    ...g,
    group_id: nextGroupId++,
    _tier: 4,
  }));

  // 4e. Trộn tất cả groups theo thứ tự tier
  const allGroups = [
    ...dayPatternGroups,
    ...personalizedGroups,
    ...userPatternGroups,
    ...tpGroups,
  ];

  // 4e. Gom flights từ tất cả groups
  const seen = new Set();
  const finalItems = allGroups
    .flatMap((g) =>
      g.flights.map((f) => ({
        ...f,
        group_id:            g.group_id,
        group_count:         g.count,
        recommendation_type: g.recommendation_type,
        badge:               g.badge,
        score:               g.score,
      })),
    )
    .filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    })
    .sort((a, b) => {
      if (a._tier !== b._tier) return a._tier - b._tier;
      return b.score - a.score;
    })
    .slice(0, limit);

  // 4g. Fallback H: nếu finalItems vẫn rỗng → dùng SELECT_TOP_POPULAR_FLIGHTS
  let finalFlights = finalItems;
  if (finalFlights.length === 0) {
    try {
      const { start, end } = monthRange;
      const popularResult = await pool.query(
        Q.SELECT_TOP_POPULAR_FLIGHTS(start, end, limit, preferredDestinations),
        [start, end, limit, preferredDestinations],
      );
      if (popularResult.rows.length > 0) {
        const popularGroupId = allGroups.length + 1;
        finalFlights = await Promise.all(popularResult.rows.map(async (r) => {
          const f = await formatFlight(r);
          return {
            ...f,
            score:               0,
            badges:              [{ label: "Tuyến phổ biến", color: "orange" }],
            recommendation_type: "popular",
            badge:               BADGE.POPULAR,
            group_id:            popularGroupId,
            group_count:         popularResult.rows.length,
            _tier:               3,
          };
        }));
        console.log("[Recommendation] Step 4g — used popular fallback, rows:", finalFlights.length);
      }
    } catch (err) {
      console.error("[Recommendation] Step 4g fallback error:", err.message);
    }
  }

  // 4h. Top source và top group
  let topSource = hasBookingHistory || hasSearchHistory
    ? (hasBookingHistory ? "personalized" : "search_based")
    : "popular";
  const topGroup = allGroups[0] || null;

  console.log("[Recommendation] Done — finalFlights:", finalFlights.length,
    "topSource:", topSource,
    "topGroup:", topGroup ? `${topGroup.route} (${topGroup.recommendation_type})` : "none");

  const result = {
    groups: allGroups.slice(0, 30),
    flights: finalFlights,
    meta: {
      total:              finalFlights.length,
      total_groups:       allGroups.length,
      limit,
      has_history:        hasHistory,
      top_source:         topSource,
      has_search_history: hasSearchHistory,
      has_booking_history: hasBookingHistory,
      filter_applied:     filter || "default",
      user_preferences: hasHistory ? {
        preferred_destinations: preferredDestinations,
        preferred_departures:   preferredDepartures,
        preferred_routes:       preferredRoutes,
        preferred_hours:        preferredHours,
        preferred_day:          preferredDay,
        preferred_week_of_month: preferredWeekOfMonth,
        preferred_dow:          preferredDOW,
        avg_spending:           avgSpending,
        month_range: {
          start: monthRange.start.split("T")[0],
          end:   monthRange.end.split("T")[0],
        },
      } : null,
      source: hasHistory
        ? (hasBookingHistory ? "personalized" : "search_based")
        : "popular",
    },
  };

  setCached(userId, sessionId, cacheKey, result).catch(() => {});
  return result;
};

module.exports = { getRecommendations };
