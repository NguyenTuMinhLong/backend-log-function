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

const BADGE = {
  DAY_PATTERN:      { label: "📅 Ngày bạn hay đặt",  color: "blue" },
  TIME_PROXIMITY:   { label: "⏰ Nhiều chuyến gần giờ", color: "purple" },
  USER_HISTORY:     { label: "⭐ Yêu thích của bạn", color: "yellow" },
  POPULAR:          { label: "🔥 Tuyến hot",           color: "orange" },
  SEARCHED:         { label: "🔍 Đang trending",       color: "teal" },
};

const DOW_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
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
 */
const formatFlight = (r, adults = 1, children = 0, infants = 0) => {
  const base = parseFloat(r.base_price) || 0;
  const multiplier = parseFloat(r.holiday_multiplier) || 1;
  const extraPrice = parseFloat(r.extra_baggage_price) || 0;
  const adjusted = base * multiplier;

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
  };
};

const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
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

  console.log("[Recommendation] Start — userId:", userId,
    "from:", fromAirport, "→", toAirport,
    "filter:", filter, "limit:", limit);

  // ── Bước 1: Phân tích user preferences từ lịch sử ──────────────────────────
  let hasHistory            = false;
  let preferredHours        = null;
  let avgSpending           = null;
  let preferredDay          = 0;
  let preferredDOW          = null;   // day-of-week ưa thích (0=Sun, 1=Mon, ..., 6=Sat)
  let preferredDestinations = [];
  let preferredDepartures   = [];
  let preferredRoutes       = [];   // Fix (a): route cụ thể dep→arr

  // 1a. Lịch sử tìm kiếm (user hoặc guest session)
  if (userId || sessionId) {
    const isUser = !!userId;
    const searchResult = await pool.query(
      isUser ? Q.SELECT_SEARCH_HISTORY_BY_USER : Q.SELECT_SEARCH_HISTORY_BY_SESSION,
      isUser ? [parseInt(userId)] : [sessionId],
    ).catch(() => ({ rows: [] }));

    if (searchResult.rows.length > 0) {
      hasHistory            = true;
      preferredDestinations  = searchResult.rows.map((r) => r.arrival_code);
      preferredDepartures   = searchResult.rows.map((r) => r.departure_code);
      avgSpending           = parseFloat(searchResult.rows[0].avg_min_price) || null;
    }
    console.log("[Recommendation] Step 1a — searchHistory rows:", searchResult.rows.length,
      "→ preferredDestinations:", preferredDestinations, "preferredDepartures:", preferredDepartures);

    // 1b. Lịch sử booking — lấy sở thích giờ, ngày, điểm đến
    if (userId) {
      const bookingResult = await pool.query(
        Q.SELECT_BOOKING_HISTORY_PREFERENCES,
        [userId],
      ).catch((err) => {
        console.error("[Recommendation] Step 1b query error:", err.message);
        return { rows: [] };
      });
      console.log("[Recommendation] Step 1b — bookingHistory rows:", bookingResult.rows.length,
        bookingResult.rows.length > 0
          ? bookingResult.rows.map(r => ({ route: r.route_key, hour: r.avg_dep_hour, day: r.preferred_day }))
          : "(no data)");

      if (bookingResult.rows.length > 0) {
        hasHistory     = true;
        preferredHours = parseFloat(bookingResult.rows[0].avg_dep_hour) || null;
        avgSpending    = parseFloat(bookingResult.rows[0].avg_price) || avgSpending;
        preferredDay   = parseFloat(bookingResult.rows[0].preferred_day) || 0;
        const rawDOW   = parseFloat(bookingResult.rows[0].preferred_dow) || null;
        preferredDOW  = (rawDOW !== null && !isNaN(rawDOW)) ? Math.round(rawDOW) : null;

        for (const r of bookingResult.rows) {
          // Fix (a): thu thập route cụ thể (dep→arr), không chỉ arrival riêng lẻ
          if (!preferredDestinations.includes(r.arr_code)) {
            preferredDestinations.push(r.arr_code);
          }
          if (!preferredDepartures.includes(r.dep_code)) {
            preferredDepartures.push(r.dep_code);
          }
        }
        // Lưu danh sách route cụ thể để dùng trong scoring
        preferredRoutes = bookingResult.rows.map(r => r.route_key);
      }
    }
  }

  // 1c. Fallback TopBuy khi không có lịch sử
  if (!hasHistory) {
    const topBuy = await pool.query(Q.SELECT_TOP_BUY_DESTINATIONS)
      .catch(() => ({ rows: [] }));
    preferredDestinations = topBuy.rows.map((r) => r.arr_code);
    console.log("[Recommendation] Step 1c — topBuy fallback:", preferredDestinations);
  }

  console.log("[Recommendation] Step 1 — hasHistory:", hasHistory,
    "preferredRoutes:", preferredRoutes,
    "preferredHours:", preferredHours,
    "preferredDay:", preferredDay,
    "preferredDOW:", preferredDOW);

  // ── Bước 2: Scored flights (from recommendFlights) ──────────────────────────
  const extraOrder   = filter === "cheapest" ? "fs.base_price ASC," : "";
  const extraFilter = filter === "early_month"
    ? "AND EXTRACT(DAY FROM f.departure_time) BETWEEN 1 AND 7" : "";

  const scoredQuery = Q.SELECT_SCORED_FLIGHTS(extraOrder, extraFilter, fromAirport, toAirport, preferredRoutes);

  const scoredResult = await pool.query(scoredQuery, [
    limit,
    preferredDestinations.length > 0 ? preferredDestinations : [""],
    preferredHours !== null ? preferredHours : 0,
    avgSpending || 0,
    preferredDay,
    preferredDepartures.length > 0 ? preferredDepartures : [""],
    preferredRoutes,
    preferredDOW !== null ? preferredDOW : -1,
  ]).catch((err) => {
    console.error("[Recommendation] Step 2 query error:", err.message);
    console.error("[Recommendation] Step 2 query text:", scoredQuery.substring(0, 200));
    console.error("[Recommendation] Step 2 params:", limit, preferredDestinations, preferredHours, avgSpending, preferredDay, preferredDepartures.length, preferredRoutes, preferredDOW);
    return { rows: [] };
  });

  console.log("[Recommendation] Step 2 — scoredResult rows:", scoredResult.rows.length,
    "preferredDOW:", preferredDOW,
    "preferredRoutes:", preferredRoutes);

  const scoredFlights = scoredResult.rows.map((r, i) => {
    const f = formatFlight(r);
    const score = parseInt(r.score, 10) || 0;
    const hour  = new Date(f.departure_time).getHours();
    const day   = new Date(f.departure_time).getDate();
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
      const dowNames = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];
      const dowFlight = new Date(f.departure_time).getDay();
      if (dowFlight === preferredDOW) {
        badges.push({ label: `Thứ ${dowNames[preferredDOW]} bạn hay đi`, color: "orange" });
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
  });

  console.log("[Recommendation] Step 2 — scoredFlights:", scoredFlights.length);

  // Gán _tier cho scoredFlights trước khi gom nhóm
  const TIER_FLIGHT = hasHistory ? 0 : 3; // user_history=0 hoặc popular=3
  scoredFlights.forEach((f) => { f._tier = TIER_FLIGHT; });

  // ── Bước 3: Recommendation groups (time proximity, day pattern) ──────────────
  // 3a. Day pattern
  let dayPatternFlights = [];
  if (hasHistory && preferredDay > 0) {
    try {
      const { start } = monthRange;
      const dayResult = await pool.query(Q.SELECT_DAYS_IN_MONTH, [start, preferredDay]);
      const dates = dayResult.rows.map((r) => r.date_value);

      if (dates.length > 0) {
        const flightsResult = await pool.query(Q.SELECT_FLIGHTS_BY_DAY_PATTERN, [dates, limit]);
      dayPatternFlights = flightsResult.rows.map((r) => ({
        ...formatFlight(r),
        recommendation_type: "day_pattern",
        badge: BADGE.DAY_PATTERN,
        score: 20,
        note: `Thứ ${formatDOW(preferredDay)} trong tháng`,
        _tier: 1, // day_pattern
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
    const result = await pool.query(Q.SELECT_FLIGHTS_FOR_TIME_GROUPING, [start, end, limit]);

    if (result.rows.length > 0) {
      const formatted = result.rows.map((r) => formatFlight(r));
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
  }));

  // 4b. Nhóm day_pattern
  const dayPatternGroups = dayPatternFlights.length > 0 ? [{
    group_id:            personalizedGroups.length + 1,
    route:               `${dayPatternFlights[0].departure.code}→${dayPatternFlights[0].arrival.code}`,
    count:               dayPatternFlights.length,
    flights:             dayPatternFlights,
    badge:               null,
    score:               20,
    recommendation_type: "day_pattern",
  }] : [];

  // 4c. Gán group_id liên tục và _tier=4 cho time_proximity
  let nextGroupId = personalizedGroups.length + dayPatternGroups.length + 1;
  const tpGroups = timeProximityGroups.map((g) => ({
    ...g,
    group_id: nextGroupId++,
    _tier: 4, // time_proximity
  }));

  // 4d. Trộn tất cả groups theo thứ tự tier
  const allGroups = [
    ...personalizedGroups,
    ...dayPatternGroups,
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

  // 4f. Top source và top group
  let topSource = hasHistory ? "personalized" : "popular";
  const topGroup = allGroups[0] || null;

  console.log("[Recommendation] Done — finalItems:", finalItems.length,
    "topSource:", topSource,
    "topGroup:", topGroup ? `${topGroup.route} (${topGroup.recommendation_type})` : "none");

  return {
    groups: allGroups.slice(0, 30),
    flights: finalItems,
    meta: {
      total:              finalItems.length,
      total_groups:       allGroups.length,
      limit,
      has_history:        hasHistory,
      top_source:         topSource,
      filter_applied:     filter || "default",
      user_preferences: hasHistory ? {
        preferred_destinations: preferredDestinations,
        preferred_departures:   preferredDepartures,
        preferred_routes:       preferredRoutes,
        preferred_hours:        preferredHours,
        preferred_day:          preferredDay,
        preferred_dow:          preferredDOW,
        avg_spending:           avgSpending,
        month_range: {
          start: monthRange.start.split("T")[0],
          end:   monthRange.end.split("T")[0],
        },
      } : null,
      source: hasHistory ? "personalized" : "popular",
    },
  };
};

module.exports = { getRecommendations };
