"use strict";

/**
 * Recommendation Service v6 — CU-05
 * Luồng ưu tiên: user_booking_history → user_search_history → popular
 * Dùng bảng sẵn có: holidays + holiday_rules
 *
 * Giới hạn: mỗi query chỉ lấy tối đa 200 rows để tránh timeout
 */

const pool = require("../config/db");
const Q = require("../queries/recommendation.queries");

const BADGE = {
  DAY_PATTERN: { label: "📅 Ngày bạn hay đặt", color: "blue" },
  TIME_PROXIMITY: { label: "⏰ Nhiều chuyến gần giờ", color: "purple" },
  USER_HISTORY: { label: "⭐ Yêu thích của bạn", color: "yellow" },
  POPULAR: { label: "🔥 Tuyến hot", color: "orange" },
  SEARCHED: { label: "🔍 Đang trending", color: "teal" },
  HOLIDAY: { label: "🎊 Ngày lễ", color: "red" },
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
    { kg: 0, label: "No extra", price_per_person: 0 },
    { kg: 5, label: "+5 kg", price_per_person: 5 * pricePerKg },
    { kg: 10, label: "+10 kg", price_per_person: 10 * pricePerKg },
    { kg: 15, label: "+15 kg", price_per_person: 15 * pricePerKg },
    { kg: 20, label: "+20 kg", price_per_person: 20 * pricePerKg },
  ];
};

const formatFlight = (r, adults = 1, children = 0, infants = 0) => {
  const base = parseFloat(r.base_price) || 0;
  const multiplier = parseFloat(r.holiday_multiplier) || 1;
  const extraPrice = parseFloat(r.extra_baggage_price) || 0;
  const adjusted = base * multiplier;

  return {
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
        adult_price: Math.round(adjusted),
        child_price: Math.round(adjusted * 0.75),
        infant_price: Math.round(adjusted * 0.1),
      },
      total_price: Math.round(
        adjusted * adults + adjusted * 0.75 * children + adjusted * 0.1 * infants,
      ),
    },
    holiday: r.holiday_id
      ? { id: r.holiday_id, name: r.holiday_name, multiplier: parseFloat(r.holiday_multiplier) || 1 }
      : null,
  };
};

const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
};

const getRecommendations = async ({ userId, sessionId, monthsAhead = 1, limit = 100 }) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const d = new Date(currentYear, currentMonth - 1, 1);
  const monthRange = getMonthRange(d.getFullYear(), d.getMonth() + 1);

  console.log("[Recommendation] Start — userId:", userId, "monthRange:", monthRange.start.split("T")[0], "→", monthRange.end.split("T")[0]);

  // ── Step 1: User history ────────────────────────────────────────
  let hasHistory = false;
  let userPatterns = { topRoutes: [], allRoutes: [], topDayOfWeek: null, topHours: [] };

  if (userId) {
    try {
      const dayResult = await pool.query(Q.SELECT_TOP_DAY_OF_WEEK, [userId]);
      if (dayResult.rows.length > 0) {
        hasHistory = true;
        userPatterns.topDayOfWeek = parseInt(dayResult.rows[0].day_of_week, 10);
      }

      const patternResult = await pool.query(Q.SELECT_USER_HISTORY_PATTERN, [userId]);
      if (patternResult.rows.length > 0) {
        hasHistory = true;

        const routeCount = {};
        const hourCount = {};
        patternResult.rows.forEach((r) => {
          const route = `${r.dep_code}→${r.arr_code}`;
          routeCount[route] = (routeCount[route] || 0) + r.trip_count;
          hourCount[r.dep_hour] = (hourCount[r.dep_hour] || 0) + r.trip_count;
        });

        const sortedRoutes = Object.entries(routeCount)
          .sort((a, b) => b[1] - a[1])
          .map(([routeStr, count]) => {
            const [dep, arr] = routeStr.split("→");
            return { dep, arr, count };
          });

        userPatterns.allRoutes = sortedRoutes;
        userPatterns.topRoutes = sortedRoutes.slice(0, 1);

        userPatterns.topHours = Object.entries(hourCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([h]) => parseInt(h, 10));
      }
    } catch (err) {
      console.error("[Recommendation] Step 1 error:", err.message);
    }
  }
  console.log("[Recommendation] Step 1 done — hasHistory:", hasHistory, "patterns:", JSON.stringify(userPatterns));

  // ── Step 2: Fallback popular flights (CHẠY TRƯỚC để có kết quả nhanh) ─
  let popularFlights = [];
  try {
    const { start, end } = monthRange;
    const result = await pool.query(Q.SELECT_TOP_POPULAR_FLIGHTS, [start, end, 100]);
    popularFlights = result.rows.map((r) => ({
      ...formatFlight(r),
      recommendation_type: "popular",
      badge: BADGE.POPULAR,
      score: parseInt(r.booking_count, 10) || 0,
    }));
    console.log("[Recommendation] Step 2 — popularFlights:", popularFlights.length);
  } catch (err) {
    console.error("[Recommendation] Step 2 error:", err.message);
  }

  // ── Step 3: User history flights ───────────────────────────────
  let userHistoryFlights = [];
  if (hasHistory) {
    try {
      const { start, end } = monthRange;
      const arrCodes = userPatterns.topRoutes.map((r) => r.arr);
      const depCodes = userPatterns.topRoutes.map((r) => r.dep);
      const dayArray = userPatterns.topDayOfWeek !== null ? [userPatterns.topDayOfWeek] : [-1];
      const hourArray = userPatterns.topHours.length > 0 ? userPatterns.topHours.slice(0, 3) : [-1];

      const result = await pool.query(Q.SELECT_FLIGHTS_BY_USER_PATTERN, [
        userId,
        arrCodes.length > 0 ? arrCodes : ["__NONE__"],
        depCodes.length > 0 ? depCodes : ["__NONE__"],
        dayArray,
        hourArray,
        start,
        end,
        limit,
      ]);
      userHistoryFlights = result.rows.map((r) => ({
        ...formatFlight(r),
        recommendation_type: "user_history",
        badge: BADGE.USER_HISTORY,
        score: parseInt(r.score, 10) || 0,
      }));
      console.log("[Recommendation] Step 3 — userHistoryFlights:", userHistoryFlights.length);
    } catch (err) {
      console.error("[Recommendation] Step 3 error:", err.message);
    }
  }

  // ── Step 3b: Search history (chỉ khi không có booking history) ──
  let searchHistoryFlights = [];
  if (!hasHistory && userId) {
    try {
      const searchResult = await pool.query(Q.SELECT_TOP_SEARCHED_ROUTES, [userId]);
      if (searchResult.rows.length > 0) {
        const { start, end } = monthRange;
        const depCodes = searchResult.rows.map((r) => r.departure_code);
        const arrCodes = searchResult.rows.map((r) => r.arrival_code);
        const result = await pool.query(Q.SELECT_FLIGHTS_BY_SEARCH_PATTERN, [
          depCodes,
          arrCodes,
          start,
          end,
          limit,
        ]);
        searchHistoryFlights = result.rows.map((r) => ({
          ...formatFlight(r),
          recommendation_type: "search_history",
          badge: BADGE.SEARCHED,
          score: 80,
        }));
        console.log("[Recommendation] Step 3b — searchHistoryFlights:", searchHistoryFlights.length);
      }
    } catch (err) {
      console.error("[Recommendation] Step 3b error:", err.message);
    }
  }

  // ── Step 4: Day pattern flights ────────────────────────────────
  let dayPatternFlights = [];
  if (hasHistory && userPatterns.topDayOfWeek !== null) {
    try {
      const { start } = monthRange;
      const dayResult = await pool.query(Q.SELECT_DAYS_IN_MONTH, [start, userPatterns.topDayOfWeek]);
      const dates = dayResult.rows.map((r) => r.date_value);

      if (dates.length > 0) {
        const flightsResult = await pool.query(Q.SELECT_FLIGHTS_BY_DAY_PATTERN, [dates, limit]);
        dayPatternFlights = flightsResult.rows.map((r) => ({
          ...formatFlight(r),
          recommendation_type: "day_pattern",
          badge: BADGE.DAY_PATTERN,
          score: 20,
          note: `Thứ ${formatDOW(userPatterns.topDayOfWeek)} trong tháng`,
        }));
      }
      console.log("[Recommendation] Step 4 — dayPatternFlights:", dayPatternFlights.length, "dates:", dates.length);
    } catch (err) {
      console.error("[Recommendation] Step 4 error:", err.message);
    }
  }

  // ── Step 5: Time proximity (nhóm chuyến cách nhau ≤30p) ───────
  let timeProximityGroups = [];
  try {
    const { start, end } = monthRange;
    const result = await pool.query(Q.SELECT_FLIGHTS_FOR_TIME_GROUPING, [start, end]);

    if (result.rows.length > 0) {
      const formatted = result.rows.slice(0, 500).map((r) => formatFlight(r));

      const routeGroups = {};
      formatted.forEach((f) => {
        const key = `${f.departure.code}→${f.arrival.code}`;
        if (!routeGroups[key]) routeGroups[key] = [];
        routeGroups[key].push(f);
      });

      Object.entries(routeGroups).forEach(([route, flights]) => {
        const sorted = [...flights].sort(
          (a, b) => new Date(a.departure_time) - new Date(b.departure_time),
        );

        let currentGroup = [sorted[0]];
        let groupId = 1;

        for (let i = 1; i < sorted.length; i++) {
          const diffMin = (new Date(sorted[i].departure_time) - new Date(sorted[i - 1].departure_time)) / 60000;
          if (diffMin <= 30) {
            currentGroup.push(sorted[i]);
          } else {
            if (currentGroup.length > 0) {
              timeProximityGroups.push({
                group_id: groupId++,
                route,
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
            route,
            count: currentGroup.length,
            flights: currentGroup,
            badge: currentGroup.length > 1 ? BADGE.TIME_PROXIMITY : null,
            score: currentGroup.length > 1 ? 30 - groupId * 2 : 5,
            recommendation_type: "time_proximity",
          });
        }
      });
    }
    console.log("[Recommendation] Step 5 — timeProximityGroups:", timeProximityGroups.length, "totalFlights:", result.rows.length);
  } catch (err) {
    console.error("[Recommendation] Step 5 error:", err.message);
  }

  // ── Step 6: MIX — ưu tiên địa điểm hay đặt nhất → search history → popular ──
  // Tier 1: user booking history (địa điểm, ngày, giờ hay đặt nhất — score cao nhất)
  // Tier 2: user search history (tuyến hay tìm nhất)
  // Tier 3: popular flights (fallback cuối cùng)
  // Time proximity groups xen kẽ giữa các tier theo score

  const groups = timeProximityGroups.slice(0, 30);

  // Gán tier cho mỗi loại để sort đúng thứ tự ưu tiên
  const TIER = { user_history: 1, day_pattern: 1, search_history: 2, popular: 3, time_proximity: 0 };

  const groupItems = groups.flatMap((g) =>
    g.flights.map((f) => ({
      ...f,
      group_id: g.group_id,
      group_count: g.count,
      recommendation_type: g.recommendation_type,
      badge: g.badge,
      score: g.score,
    })),
  );

  const allItems = [
    ...userHistoryFlights.map((f) => ({ ...f, _tier: TIER.user_history })),
    ...dayPatternFlights.map((f) => ({ ...f, _tier: TIER.day_pattern })),
    ...searchHistoryFlights.map((f) => ({ ...f, _tier: TIER.search_history })),
    ...groupItems.map((f) => ({ ...f, _tier: TIER.time_proximity })),
    ...popularFlights.map((f) => ({ ...f, _tier: TIER.popular })),
  ];

  const seen = new Set();
  const finalItems = allItems
    .filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    })
    // Ưu tiên tier thấp (cao hơn) trước, rồi mới đến score cao
    .sort((a, b) => {
      if (a._tier !== b._tier) return a._tier - b._tier;
      return b.score - a.score;
    })
    .slice(0, limit);

  // metadata: ưu tiên nguồn nào có dữ liệu thì dùng nguồn đó
  let topSource = "popular";
  if (userHistoryFlights.length > 0) topSource = "user_history";
  else if (searchHistoryFlights.length > 0) topSource = "search_history";
  else if (popularFlights.length > 0) topSource = "popular";

  console.log("[Recommendation] Done — finalItems:", finalItems.length, "topSource:", topSource);

  return {
    groups: groups.slice(0, 30),
    flights: finalItems,
    meta: {
      total: finalItems.length,
      total_groups: groups.length,
      limit,
      has_history: hasHistory,
      top_source: topSource,
      user_preferences: hasHistory
        ? {
            top_routes: userPatterns.topRoutes,
            top_day_of_week: userPatterns.topDayOfWeek,
            top_day_of_week_name: formatDOW(userPatterns.topDayOfWeek),
            top_hours: userPatterns.topHours,
            all_routes: userPatterns.allRoutes,
            month_range: {
              start: monthRange.start.split("T")[0],
              end: monthRange.end.split("T")[0],
            },
          }
        : null,
      source: hasHistory ? "personalized" : "popular",
    },
  };
};

module.exports = { getRecommendations };
