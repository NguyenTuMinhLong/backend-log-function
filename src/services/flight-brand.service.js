"use strict";

const pool = require("../config/db");

/**
 * FLIGHT BRANDS — Gợi ý kết hợp hãng tối ưu cho khứ hồi
 *
 * Logic:
 * 1. Tìm tất cả chuyến đi còn vé (dep → arr, departure_date)
 * 2. Tìm tất cả chuyến về còn vé (arr → dep, return_date)
 * 3. Ghép các cặp chuyến đi/về khác hãng
 * 4. Chấm điểm theo: tổng giá, thời gian chờ, hãng uy tín
 * 5. Trả về top combinations
 */

// Điểm uy tín hãng (dựa theo thực tế)
const AIRLINE_SCORE = {
  SQ: 95, QR: 94, EK: 93, CX: 92, NH: 91, JL: 90,
  TG: 88, MH: 87, KE: 86, OZ: 85, GA: 84,
  VN: 82, LH: 82, BA: 81, AF: 80, KL: 80,
  QF: 79, EY: 78, TK: 77, CA: 76, MU: 75,
  VJ: 70, AK: 68, QH: 72, TR: 68, JQ: 65,
};

const getAirlineScore = (code) => AIRLINE_SCORE[code] || 60;

/**
 * Query chuyến bay theo tuyến + ngày
 */
const queryFlightsByRoute = async (depCode, arrCode, date, seatClass, passengers) => {
  const seatsNeeded = passengers.adults + passengers.children;

  const result = await pool.query(`
    SELECT
      f.id, f.flight_number, f.departure_time, f.arrival_time, f.duration_minutes,
      al.id AS airline_id, al.code AS airline_code, al.name AS airline_name,
      al.logo_url, al.logo_dark, al.logo_light,
      dep.code AS dep_code, dep.city AS dep_city, dep.name AS dep_name,
      arr.code AS arr_code, arr.city AS arr_city, arr.name AS arr_name,
      fs.base_price, fs.available_seats, fs.baggage_included_kg,
      fs.carry_on_kg, fs.extra_baggage_price
    FROM flights f
    JOIN airlines     al  ON al.id  = f.airline_id
    JOIN airports     dep ON dep.id = f.departure_airport_id
    JOIN airports     arr ON arr.id = f.arrival_airport_id
    JOIN flight_seats fs  ON fs.flight_id = f.id AND fs.class = $3
    WHERE dep.code          = $1
      AND arr.code          = $2
      AND DATE(f.departure_time) = $4
      AND f.status          = 'scheduled'
      AND f.is_active       = TRUE
      AND fs.available_seats >= $5
    ORDER BY fs.base_price ASC
    LIMIT 20
  `, [depCode, arrCode, seatClass, date, seatsNeeded]);

  return result.rows;
};

/**
 * Tính tổng tiền theo hành khách
 */
const calcTotal = (basePrice, adults, children, infants) =>
  Math.round(basePrice * adults + basePrice * 0.75 * children + basePrice * 0.10 * infants);

/**
 * Format 1 chuyến bay
 */
const formatFlight = (r, passengers) => {
  const base  = parseFloat(r.base_price);
  const total = calcTotal(base, passengers.adults, passengers.children, passengers.infants);
  return {
    flight_id:     r.id,
    flight_number: r.flight_number,
    departure:     { code: r.dep_code, city: r.dep_city, name: r.dep_name, time: r.departure_time },
    arrival:       { code: r.arr_code, city: r.arr_city, name: r.arr_name, time: r.arrival_time },
    duration_minutes: r.duration_minutes,
    duration_label:   formatDuration(r.duration_minutes),
    airline: {
      id:        r.airline_id,
      code:      r.airline_code,
      name:      r.airline_name,
      logo_url:  r.logo_url,
      logo_dark: r.logo_dark,
      logo_light: r.logo_light,
      score:     getAirlineScore(r.airline_code),
    },
    seat: {
      base_price:          base,
      total_price:         total,
      available_seats:     r.available_seats,
      baggage_included_kg: r.baggage_included_kg,
      carry_on_kg:         r.carry_on_kg,
      extra_baggage_price: parseFloat(r.extra_baggage_price) || 0,
    },
  };
};

const formatDuration = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return m > 0 ? `${h}h${m}m` : `${h}h`;
};

/**
 * Gợi ý kết hợp hãng tối ưu
 * GET /api/flights/brand-combinations
 */
const getBrandCombinations = async ({
  departure_code, arrival_code,
  departure_date, return_date,
  seat_class = 'economy',
  adults = 1, children = 0, infants = 0,
  limit = 5,
}) => {
  if (!departure_code || !arrival_code || !departure_date || !return_date) {
    throw new Error("departure_code, arrival_code, departure_date, return_date là bắt buộc");
  }

  const dep  = departure_code.toUpperCase();
  const arr  = arrival_code.toUpperCase();
  const cls  = seat_class.toLowerCase();
  const pax  = { adults: parseInt(adults), children: parseInt(children), infants: parseInt(infants) };
  const lim  = parseInt(limit);

  // 1. Lấy chuyến đi + chuyến về song song
  const [outboundRows, returnRows] = await Promise.all([
    queryFlightsByRoute(dep, arr, departure_date, cls, pax),
    queryFlightsByRoute(arr, dep, return_date,    cls, pax),
  ]);

  if (outboundRows.length === 0) throw new Error("Không tìm thấy chuyến đi phù hợp");
  if (returnRows.length   === 0) throw new Error("Không tìm thấy chuyến về phù hợp");

  // 2. Format flights
  const outboundFlights = outboundRows.map(r => formatFlight(r, pax));
  const returnFlights   = returnRows.map(r   => formatFlight(r, pax));

  // 3. Ghép tất cả cặp (outbound × return) và chấm điểm
  const combinations = [];

  for (const out of outboundFlights) {
    for (const ret of returnFlights) {
      const isSameAirline    = out.airline.code === ret.airline.code;
      const totalPrice       = out.seat.total_price + ret.seat.total_price;
      const avgAirlineScore  = (out.airline.score + ret.airline.score) / 2;

      // Tính thời gian chờ ở điểm đến (arr → dep return)
      const arrivalTime      = new Date(out.arrival.time);
      const returnDepTime    = new Date(ret.departure.time);
      const layoverHours     = (returnDepTime - arrivalTime) / (1000 * 60 * 60);

      // Bỏ qua nếu thời gian chờ quá ngắn (< 2h) hoặc quá dài (> 30 ngày)
      if (layoverHours < 2 || layoverHours > 24 * 30) continue;

      // Scoring combination
      let score = 0;

      // Tổng giá thấp: +40 điểm (normalize)
      const minPossiblePrice = outboundFlights[0].seat.total_price + returnFlights[0].seat.total_price;
      const priceScore = Math.max(0, 40 - Math.round(((totalPrice - minPossiblePrice) / minPossiblePrice) * 40));
      score += priceScore;

      // Hãng khác nhau (đây là tính năng chính): +20 nếu tiết kiệm hơn same-airline
      if (!isSameAirline) score += 20;

      // Điểm uy tín hãng trung bình
      score += Math.round(avgAirlineScore / 5);

      // Thời gian chờ hợp lý (3-12h): +10
      if (layoverHours >= 3 && layoverHours <= 12) score += 10;

      // Bay thẳng cả 2 chiều: +10
      if (out.duration_minutes < 300 && ret.duration_minutes < 300) score += 10;

      combinations.push({
        outbound_flight: out,
        return_flight:   ret,
        is_same_airline: isSameAirline,
        airlines: isSameAirline
          ? `${out.airline.name} (cả 2 chiều)`
          : `${out.airline.name} + ${ret.airline.name}`,
        total_price:     totalPrice,
        layover_hours:   Math.round(layoverHours * 10) / 10,
        score,
        highlight: !isSameAirline && priceScore >= 20
          ? `Tiết kiệm hơn khi kết hợp ${out.airline.name} & ${ret.airline.name}`
          : null,
      });
    }
  }

  if (combinations.length === 0) {
    throw new Error("Không tìm thấy kết hợp hãng bay phù hợp");
  }

  // 4. Sắp xếp theo score DESC, lấy top N
  combinations.sort((a, b) => b.score - a.score || a.total_price - b.total_price);
  const topCombinations = combinations.slice(0, lim);

  // 5. Tách nhóm: cùng hãng vs khác hãng
  const sameAirline  = topCombinations.filter(c => c.is_same_airline);
  const mixedAirline = topCombinations.filter(c => !c.is_same_airline);

  // Giá thấp nhất trong top
  const cheapest = topCombinations[0];
  const cheapestSame  = sameAirline[0]  || null;
  const cheapestMixed = mixedAirline[0] || null;

  return {
    passengers:      { adults: pax.adults, children: pax.children, infants: pax.infants },
    seat_class:      cls,
    route:           { departure_code: dep, arrival_code: arr, departure_date, return_date },
    summary: {
      total_combinations:   topCombinations.length,
      same_airline_count:   sameAirline.length,
      mixed_airline_count:  mixedAirline.length,
      cheapest_total:       cheapest.total_price,
      // So sánh giá cùng hãng vs khác hãng
      same_airline_price:   cheapestSame  ? cheapestSame.total_price  : null,
      mixed_airline_price:  cheapestMixed ? cheapestMixed.total_price : null,
      saving_by_mixing:     cheapestSame && cheapestMixed
        ? cheapestSame.total_price - cheapestMixed.total_price
        : null,
    },
    combinations: topCombinations,
  };
};

module.exports = { getBrandCombinations };