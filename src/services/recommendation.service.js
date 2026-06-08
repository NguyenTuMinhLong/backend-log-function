"use strict";

/**
 * Recommendation Service v4 — CU-05
 * Dùng bảng sẵn có: holidays + holiday_rules
 *
 * 3 luồng:
 *   1. DAY_PATTERN  – theo ngày trong tuần user hay đặt nhất
 *   2. TIME_PROXIMITY – nhóm chuyến cách nhau ≤ 30 phút
 *   3. USER_HISTORY   – score địa điểm*5 + ngày*3 + giờ*2
 * Fallback: top_popular (100) → top_searched
 */

const pool = require("../config/db");
const Q = require("../queries/recommendation.queries");

// ─── Badges ────────────────────────────────────────────────────────
const BADGE = {
  DAY_PATTERN: { label: "📅 Ngày bạn hay đặt", color: "blue" },
  TIME_PROXIMITY: { label: "⏰ Nhiều chuyến gần giờ", color: "purple" },
  USER_HISTORY: { label: "⭐ Yêu thích của bạn", color: "yellow" },
  POPULAR: { label: "🔥 Tuyến hot", color: "orange" },
  SEARCHED: { label: "🔍 Đang trending", color: "teal" },
  HOLIDAY: { label: "🎊 Ngày lễ", color: "red" },
};

// ─── Constants ─────────────────────────────────────────────────────
const TIME_WINDOW_MINUTES = 30;
const MAX_PER_GROUP = 1000;

// ─── Helpers ───────────────────────────────────────────────────────
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

// ─── Format 1 flight row → object ─────────────────────────────────
const formatFlight = (r, adults = 1, children = 0, infants = 0) => {
  const base = parseFloat(r.base_price) || 0;
  const multiplier = parseFloat(r.price_multiplier) || 1;
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
      ? { id: r.holiday_id, name: r.holiday_name, type: r.holiday_type || r.type }
      : null,
  };
};

// ─── Group flights by 30-minute window ────────────────────────────
// Luồng 2: nhóm 2+ chuyến cùng route cách nhau ≤ 30 phút
const groupFlightsBy30Min = (flights) => {
  if (!flights || flights.length === 0) return [];

  const sorted = [...flights].sort(
    (a, b) => new Date(a.departure_time) - new Date(b.departure_time),
  );

  const groups = [];
  let currentGroup = {
    flights: [sorted[0]],
    departure_time: sorted[0].departure_time,
    route: `${sorted[0].departure.code}→${sorted[0].arrival.code}`,
  };

  for (let i = 1; i < sorted.length; i++) {
    const diffMs =
      new Date(sorted[i].departure_time) - new Date(sorted[i - 1].departure_time);
    const diffMin = diffMs / (1000 * 60);

    if (diffMin <= TIME_WINDOW_MINUTES) {
      currentGroup.flights.push(sorted[i]);
    } else {
      if (currentGroup.flights.length > 0) groups.push(currentGroup);
      currentGroup = {
        flights: [sorted[i]],
        departure_time: sorted[i].departure_time,
        route: `${sorted[i].departure.code}→${sorted[i].arrival.code}`,
      };
    }
  }
  if (currentGroup.flights.length > 0) groups.push(currentGroup);

  // Gán group_id, trim oversized groups
  return groups
    .map((g, idx) => ({
      ...g,
      group_id: idx + 1,
      count: g.flights.length,
      flights: g.flights.slice(0, MAX_PER_GROUP),
    }))
    .filter((g) => g.count >= 1); // giữ cả nhóm 1 chuyến (sẽ hiển thị riêng)
};

// ─── Month range ──────────────────────────────────────────────────
const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
};

// ─── Main function ────────────────────────────────────────────────
const getRecommendations = async ({
  userId,
  sessionId,
  monthsAhead = 3,
  limit = 200,
}) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Build month ranges
  const monthRanges = [];
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(currentYear, currentMonth - 1 + i, 1);
    monthRanges.push(getMonthRange(d.getFullYear(), d.getMonth() + 1));
  }
  const firstRange = monthRanges[0];
  const lastRange = monthRanges[monthRanges.length - 1];

  // ── Step 1: User history ────────────────────────────────────────
  let hasHistory = false;
  let userPatterns = { topRoutes: [], topDayOfWeek: null, topHours: [] };

  if (userId) {
    try {
      const dayResult = await pool.query(Q.SELECT_TOP_DAY_OF_WEEK, [userId]);
      if (dayResult.rows.length > 0) {
        hasHistory = true;
        userPatterns.topDayOfWeek = parseInt(dayResult.rows[0].day_of_week, 10);
      }

      const patternResult = await pool.query(Q.SELECT_USER_HISTORY_PATTERN, [
        userId,
      ]);
      if (patternResult.rows.length > 0) {
        hasHistory = true;

        const routeCount = {};
        const hourCount = {};
        patternResult.rows.forEach((r) => {
          const route = `${r.dep_code}→${r.arr_code}`;
          routeCount[route] = (routeCount[route] || 0) + r.trip_count;
          hourCount[r.dep_hour] = (hourCount[r.dep_hour] || 0) + r.trip_count;
        });

        const topRoute = Object.entries(routeCount).sort((a, b) => b[1] - a[1])[0];
        if (topRoute) {
          const [routeStr] = topRoute;
          const [dep, arr] = routeStr.split("→");
          userPatterns.topRoutes = [{ dep, arr }];
        }

        userPatterns.topHours = Object.entries(hourCount)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([h]) => parseInt(h, 10));
      }
    } catch (err) {
      console.error("[Recommendation] Lỗi phân tích user history:", err.message);
    }
  }

  // ── Step 2: Holidays ────────────────────────────────────────────
  let holidayDates = new Set();
  try {
    const result = await pool.query(Q.SELECT_HOLIDAYS_IN_RANGE, [
      firstRange.start.split("T")[0],
      lastRange.end.split("T")[0],
    ]);
    result.rows.forEach((h) => holidayDates.add(h.date));
  } catch (err) {
    console.error("[Recommendation] Lỗi lấy holidays:", err.message);
  }

  // ── Step 3: Lấy tất cả flights trong tháng ────────────────────
  // Dùng chung cho cả 3 luồng + fallback
  let allFlights = [];
  try {
    const { start, end } = firstRange;
    const flightsResult = await pool.query(
      Q.SELECT_FLIGHTS_FOR_TIME_GROUPING,
      [start, end],
    );
    allFlights = flightsResult.rows;
  } catch (err) {
    console.error(
      "[Recommendation] Lỗi lấy flights:",
      err.message,
    );
  }

  if (allFlights.length === 0) {
    // Không có chuyến bay nào → trả rỗng
    return {
      groups: [],
      flights: [],
      meta: {
        total: 0,
        total_groups: 0,
        limit,
        has_history: hasHistory,
        holiday_dates: Array.from(holidayDates),
        user_preferences: hasHistory
          ? {
              top_day_of_week: userPatterns.topDayOfWeek,
              top_day_of_week_name: formatDOW(userPatterns.topDayOfWeek),
              top_hours: userPatterns.topHours,
            }
          : null,
        source: hasHistory ? "personalized" : "popular",
      },
    };
  }

  // ── Step 4: LUỒNG 1 — DAY_PATTERN ───────────────────────────
  let dayPatternFlights = [];
  let dayPatternDates = [];

  if (hasHistory && userPatterns.topDayOfWeek !== null) {
    try {
      const dayResult = await pool.query(Q.SELECT_DAYS_IN_MONTH, [
        firstRange.start,
        userPatterns.topDayOfWeek,
      ]);
      dayPatternDates = dayResult.rows.map((r) => r.date_value);

      if (dayPatternDates.length > 0) {
        const flightsResult = await pool.query(
          Q.SELECT_FLIGHTS_BY_DAY_PATTERN,
          [dayPatternDates, limit],
        );
        dayPatternFlights = flightsResult.rows.map((r) => ({
          ...formatFlight(r),
          recommendation_type: "day_pattern",
          badge: BADGE.DAY_PATTERN,
          score: 20,
          note: `Thứ ${formatDOW(userPatterns.topDayOfWeek)} trong tháng`,
        }));
      }
    } catch (err) {
      console.error(
        "[Recommendation] Lỗi luồng 1 (DAY_PATTERN):",
        err.message,
      );
    }
  }

  // ── Step 5: LUỒNG 2 — TIME_PROXIMITY ───────────────────────
  let timeProximityGroups = [];

  try {
    const formattedFlights = allFlights.map((r) => formatFlight(r));

    // Group theo route trước
    const routeGroups = {};
    formattedFlights.forEach((f) => {
      const key = `${f.departure.code}→${f.arrival.code}`;
      if (!routeGroups[key]) routeGroups[key] = [];
      routeGroups[key].push(f);
    });

    // Gom nhóm 30 phút cho từng route
    Object.entries(routeGroups).forEach(([route, flights]) => {
      const groups = groupFlightsBy30Min(flights);
      groups.forEach((g) => {
        timeProximityGroups.push({
          ...g,
          route,
          recommendation_type: "time_proximity",
          badge: g.count > 1 ? BADGE.TIME_PROXIMITY : null,
          score: g.count > 1 ? 30 - g.group_id * 2 : 5,
        });
      });
    });

    timeProximityGroups.sort((a, b) => b.score - a.score);
    timeProximityGroups = timeProximityGroups.slice(0, 100);
  } catch (err) {
    console.error(
      "[Recommendation] Lỗi luồng 2 (TIME_PROXIMITY):",
      err.message,
    );
  }

  // ── Step 6: LUỒNG 3 — USER_HISTORY ──────────────────────────
  let userHistoryFlights = [];

  if (hasHistory) {
    try {
      const { start, end } = firstRange;

      const arrCodes = userPatterns.topRoutes.map((r) => r.arr);
      const depCodes = userPatterns.topRoutes.map((r) => r.dep);
      const dayArray =
        userPatterns.topDayOfWeek !== null
          ? [userPatterns.topDayOfWeek]
          : [];
      const hourArray =
        userPatterns.topHours.length > 0
          ? userPatterns.topHours.slice(0, 3)
          : [];

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
    } catch (err) {
      console.error(
        "[Recommendation] Lỗi luồng 3 (USER_HISTORY):",
        err.message,
      );
    }
  }

  // ── Step 7: FALLBACK — top popular ───────────────────────────
  let popularFlights = [];

  // Luôn chạy fallback nếu không có kết quả từ các luồng trên
  const hasAnyResults =
    userHistoryFlights.length > 0 ||
    dayPatternFlights.length > 0 ||
    timeProximityGroups.length > 0;

  if (!hasAnyResults) {
    try {
      const { start, end } = firstRange;
      const popularResult = await pool.query(
        Q.SELECT_TOP_POPULAR_FLIGHTS,
        [start, end, 100],
      );
      popularFlights = popularResult.rows.map((r) => ({
        ...formatFlight(r),
        recommendation_type: "popular",
        badge: BADGE.POPULAR,
        score: parseInt(r.booking_count, 10) || 0,
      }));
    } catch (err) {
      console.error(
        "[Recommendation] Lỗi fallback popular:",
        err.message,
      );
    }
  }

  // ── Step 8: FALLBACK — top searched ───────────────────────────
  let searchedFlights = [];

  if (!hasAnyResults && userId) {
    try {
      const searchedResult = await pool.query(Q.SELECT_TOP_SEARCHED_ROUTES, [
        userId,
      ]);
      const topSearched = searchedResult.rows[0];
      if (topSearched) {
        searchedFlights = allFlights
          .filter(
            (r) =>
              r.departure_code === topSearched.departure_code &&
              r.arrival_code === topSearched.arrival_code,
          )
          .slice(0, 100)
          .map((r) => ({
            ...formatFlight(r),
            recommendation_type: "searched",
            badge: BADGE.SEARCHED,
            score: topSearched.search_count,
          }));
      }
    } catch (err) {
      console.error(
        "[Recommendation] Lỗi fallback searched:",
        err.message,
      );
    }
  }

  // ── Step 9: MIX — gom groups + flights ────────────────────────
  // Mỗi group trả về 1 object { group_id, route, count, flights: [...] }
  const groups = timeProximityGroups.map((g) => ({
    group_id: g.group_id,
    route: g.route,
    count: g.count,
    flights: g.flights,
    badge: g.badge,
    score: g.score,
    recommendation_type: g.recommendation_type,
  }));

  // Flatten groups → flights để mix chung
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
    ...userHistoryFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
    })),
    ...dayPatternFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
    })),
    ...groupItems,
    ...popularFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
    })),
    ...searchedFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
    })),
  ];

  // Sort by score desc, deduplicate by id
  const seen = new Set();
  const finalItems = allItems
    .filter((f) => {
      if (seen.has(f.id)) return false;
      seen.add(f.id);
      return true;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return {
    groups: groups.slice(0, 50),
    flights: finalItems,
    meta: {
      total: finalItems.length,
      total_groups: groups.length,
      all_flights_count: allFlights.length,
      limit,
      has_history: hasHistory,
      holiday_dates: Array.from(holidayDates),
      user_preferences: hasHistory
        ? {
            top_routes: userPatterns.topRoutes,
            top_day_of_week: userPatterns.topDayOfWeek,
            top_day_of_week_name: formatDOW(userPatterns.topDayOfWeek),
            top_hours: userPatterns.topHours,
            day_pattern_dates: dayPatternDates,
            month_range: {
              start: firstRange.start.split("T")[0],
              end: lastRange.end.split("T")[0],
            },
          }
        : null,
      source: hasHistory ? "personalized" : "popular",
    },
  };
};

module.exports = { getRecommendations };
