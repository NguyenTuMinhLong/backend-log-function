"use strict";

/**
 * Recommendation Service v3 — CU-05
 * Dùng bảng sẵn có: holidays + holiday_rules
 *
 * 3 luồng gợi ý:
 *   1. DAY_PATTERN  – theo ngày trong tuần user hay đặt nhất
 *   2. TIME_PROXIMITY – nhóm chuyến cách nhau ≤ 30 phút
 *   3. USER_HISTORY   – score địa điểm*5 + ngày*3 + giờ*1
 * Fallback: top_popular → top_searched
 * Mix 3 luồng, tối đa 1000 kết quả
 */

const pool = require("../config/db");
const Q = require("../queries/recommendation.queries");

// ─── Badge definitions ─────────────────────────────────────────────
const BADGE = {
  DAY_PATTERN: { label: "📅 Ngày bạn hay đặt", color: "blue" },
  TIME_PROXIMITY: { label: "⏰ Nhiều chuyến gần giờ", color: "purple" },
  USER_HISTORY: { label: "⭐ Yêu thích của bạn", color: "yellow" },
  POPULAR: { label: "🔥 Tuyến hot", color: "orange" },
  SEARCHED: { label: "🔍 Đang trending", color: "teal" },
  HOLIDAY: { label: "🎊 Ngày lễ", color: "red" },
};

// ─── Constants ─────────────────────────────────────────────────────
const MAX_RESULTS = 1000;
const TIME_WINDOW_MINUTES = 30;
const MAX_PER_GROUP = 1000;

// ─── Day name helpers ─────────────────────────────────────────────
const DOW_NAMES = ["CN", "T2", "T3", "T4", "T5", "T6", "T7"];

const formatDOW = (dow) =>
  DOW_NAMES[parseInt(dow, 10)] || `T${dow}`;

// ─── Duration ─────────────────────────────────────────────────────
const formatDuration = (minutes) => {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

// ─── Price helpers ────────────────────────────────────────────────
const calcTotalPrice = (basePrice, multiplier, adults, children, infants) => {
  const adjusted = basePrice * (multiplier || 1);
  const adultTotal = adjusted * adults;
  const childTotal = adjusted * 0.75 * children;
  const infantTotal = adjusted * 0.1 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
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

// ─── Format 1 flight row → object ────────────────────────────────
const formatFlight = (r, adults = 1, children = 0, infants = 0) => {
  const base = parseFloat(r.base_price) || 0;
  const multiplier = parseFloat(r.price_multiplier) || 1;
  const extraPrice = parseFloat(r.extra_baggage_price) || 0;

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
      adjusted_price: Math.round(base * multiplier),
      baggage_included_kg: r.baggage_included_kg,
      carry_on_kg: r.carry_on_kg,
      extra_baggage_price: extraPrice,
      extra_baggage_options: buildBaggageOptions(extraPrice),
      price_breakdown: {
        adult_price: Math.round(base * multiplier),
        child_price: Math.round(base * multiplier * 0.75),
        infant_price: Math.round(base * multiplier * 0.1),
      },
      total_price: calcTotalPrice(base, multiplier, adults, children, infants),
    },
    holiday: r.holiday_id
      ? {
          id: r.holiday_id,
          name: r.holiday_name,
          type: r.holiday_type || r.type,
        }
      : null,
  };
};

// ─── Group flights by 30-minute window ────────────────────────────
const groupFlightsBy30Min = (flights) => {
  if (!flights || flights.length === 0) return [];

  const sorted = [...flights].sort(
    (a, b) => new Date(a.departure_time) - new Date(b.departure_time),
  );

  const groups = [];
  let currentGroup = {
    group_id: 1,
    flights: [sorted[0]],
    departure_time: sorted[0].departure_time,
    route: `${sorted[0].departure.code} → ${sorted[0].arrival.code}`,
    count: 1,
  };

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const diffMs =
      new Date(curr.departure_time) - new Date(prev.departure_time);
    const diffMin = diffMs / (1000 * 60);

    if (diffMin <= TIME_WINDOW_MINUTES) {
      currentGroup.flights.push(curr);
      currentGroup.count = currentGroup.flights.length;
    } else {
      if (currentGroup.count > 0) groups.push(currentGroup);
      currentGroup = {
        group_id: groups.length + 1,
        flights: [curr],
        departure_time: curr.departure_time,
        route: `${curr.departure.code} → ${curr.arrival.code}`,
        count: 1,
      };
    }
  }

  if (currentGroup.count > 0) groups.push(currentGroup);

  return groups
    .map((g, idx) => ({
      ...g,
      group_id: idx + 1,
      flights: g.flights.slice(0, MAX_PER_GROUP),
    }))
    .filter((g) => g.count > 1);
};

// ─── Month range ──────────────────────────────────────────────────
const getMonthRange = (year, month) => {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59);
  return { start: start.toISOString(), end: end.toISOString() };
};

// ─── Main recommendation function ──────────────────────────────────
const getRecommendations = async ({
  userId,
  sessionId,
  monthsAhead = 3,
  limit = MAX_RESULTS,
}) => {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // ── Build month ranges ────────────────────────────────────────────
  const monthRanges = [];
  for (let i = 0; i < monthsAhead; i++) {
    const d = new Date(currentYear, currentMonth - 1 + i, 1);
    monthRanges.push(getMonthRange(d.getFullYear(), d.getMonth() + 1));
  }

  const firstRange = monthRanges[0];
  const lastRange = monthRanges[monthRanges.length - 1];

  // ── Step 1: User history ──────────────────────────────────────────
  let hasHistory = false;
  let userPatterns = {
    topRoutes: [],
    topDayOfWeek: null,
    topHours: [],
  };

  if (userId) {
    try {
      const dayResult = await pool.query(Q.SELECT_TOP_DAY_OF_WEEK, [userId]);
      if (dayResult.rows.length > 0) {
        hasHistory = true;
        userPatterns.topDayOfWeek = parseInt(dayResult.rows[0].day_of_week, 10);
      }

      const patternResult = await pool.query(
        Q.SELECT_USER_HISTORY_PATTERN,
        [userId],
      );
      if (patternResult.rows.length > 0) {
        hasHistory = true;

        const routeCount = {};
        const hourCount = {};
        patternResult.rows.forEach((r) => {
          const route = `${r.dep_code}→${r.arr_code}`;
          routeCount[route] = (routeCount[route] || 0) + r.trip_count;
          hourCount[r.dep_hour] = (hourCount[r.dep_hour] || 0) + r.trip_count;
        });

        const topRoute = Object.entries(routeCount).sort(
          (a, b) => b[1] - a[1],
        )[0];
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

  // ── Step 2: Holidays ───────────────────────────────────────────────
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

  // ── Step 3: LUỒNG 1 — DAY_PATTERN ───────────────────────────────
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
          [dayPatternDates, Math.min(limit, 200)],
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

  // ── Step 4: LUỒNG 2 — TIME_PROXIMITY ───────────────────────────
  let timeProximityGroups = [];

  try {
    const { start, end } = firstRange;
    const flightsResult = await pool.query(
      Q.SELECT_FLIGHTS_FOR_TIME_GROUPING,
      [start, end],
    );
    const allFlights = flightsResult.rows.map((r) => formatFlight(r));

    const routeGroups = {};
    allFlights.forEach((f) => {
      const key = `${f.departure.code}→${f.arrival.code}`;
      if (!routeGroups[key]) routeGroups[key] = [];
      routeGroups[key].push(f);
    });

    Object.entries(routeGroups).forEach(([route, flights]) => {
      const groups = groupFlightsBy30Min(flights);
      groups.forEach((g) => {
        timeProximityGroups.push({
          ...g,
          route,
          recommendation_type: "time_proximity",
          badge: BADGE.TIME_PROXIMITY,
          score: 30 - g.group_id * 2,
        });
      });
    });

    timeProximityGroups.sort((a, b) => b.score - a.score);
    timeProximityGroups = timeProximityGroups.slice(0, 50);
  } catch (err) {
    console.error(
      "[Recommendation] Lỗi luồng 2 (TIME_PROXIMITY):",
      err.message,
    );
  }

  // ── Step 5: LUỒNG 3 — USER_HISTORY ──────────────────────────────
  let userHistoryFlights = [];

  if (hasHistory) {
    try {
      const { start, end } = firstRange;

      const arrCodes = userPatterns.topRoutes.map((r) => r.arr);
      const depCodes = userPatterns.topRoutes.map((r) => r.dep);
      const dayArray = userPatterns.topDayOfWeek !== null
        ? [userPatterns.topDayOfWeek]
        : [99];
      const hourArray =
        userPatterns.topHours.length > 0 ? userPatterns.topHours.slice(0, 3) : [99];

      const result = await pool.query(Q.SELECT_FLIGHTS_BY_USER_PATTERN, [
        userId,
        arrCodes.length > 0 ? arrCodes : ["__NONE__"],
        depCodes.length > 0 ? depCodes : ["__NONE__"],
        dayArray,
        hourArray,
        start,
        end,
        Math.min(limit, 200),
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

  // ── Step 6: FALLBACK — top popular ───────────────────────────────
  let popularFlights = [];

  if (!hasHistory || userHistoryFlights.length === 0) {
    try {
      const { start, end } = firstRange;
      const popularResult = await pool.query(Q.SELECT_TOP_POPULAR_FLIGHTS, [
        start,
        end,
      ]);
      popularFlights = popularResult.rows.slice(0, 100).map((r) => ({
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

  // ── Step 7: FALLBACK — top searched routes ───────────────────────
  let searchedFlights = [];

  if (!hasHistory || searchedFlights.length === 0) {
    try {
      if (userId) {
        const searchedResult = await pool.query(Q.SELECT_TOP_SEARCHED_ROUTES, [
          userId,
        ]);
        const topSearched = searchedResult.rows[0];
        if (topSearched) {
          const { start, end } = firstRange;
          const allFlightsResult = await pool.query(
            Q.SELECT_FLIGHTS_FOR_TIME_GROUPING,
            [start, end],
          );
          searchedFlights = allFlightsResult.rows
            .filter(
              (r) =>
                r.departure_code === topSearched.departure_code &&
                r.arrival_code === topSearched.arrival_code,
            )
            .slice(0, 50)
            .map((r) => ({
              ...formatFlight(r),
              recommendation_type: "searched",
              badge: BADGE.SEARCHED,
              score: topSearched.search_count,
            }));
        }
      }
    } catch (err) {
      console.error(
        "[Recommendation] Lỗi fallback searched:",
        err.message,
      );
    }
  }

  // ── Step 8: MIX 3 luồng ──────────────────────────────────────────
  const groups = timeProximityGroups;

  const groupItems = groups.flatMap((g) =>
    g.flights.map((f) => ({
      ...f,
      recommendation_type: g.recommendation_type,
      badge: g.badge,
      score: g.score,
      group_id: g.group_id,
      group_count: g.count,
      route: g.route,
    })),
  );

  const allItems = [
    ...userHistoryFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
      route: null,
    })),
    ...dayPatternFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
      route: null,
    })),
    ...groupItems,
    ...popularFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
      route: null,
    })),
    ...searchedFlights.map((f) => ({
      ...f,
      group_id: null,
      group_count: 0,
      route: null,
    })),
  ];

  // Sort by score desc
  allItems.sort((a, b) => b.score - a.score);

  // ── Step 9: Tách ngày lễ vs ngày thường ───────────────────────
  // Duy trì 1 danh sách mix nhưng có nhãn rõ ràng trong từng item
  const finalItems = allItems.slice(0, limit);

  // ── Step 10: Build response ──────────────────────────────────────
  return {
    groups: groups.slice(0, 20),
    flights: finalItems,
    meta: {
      total: finalItems.length,
      total_groups: groups.length,
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
