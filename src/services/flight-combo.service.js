/*
============================================================
FLIGHT COMBO SERVICE - Tìm combos multi-leg cross-airline
============================================================

Tìm combos: one-way (direct/1-stop/2-stop) + roundtrip

Features:
- Direct: Bay thẳng (0 stop)
- 1-stop: 1 điểm dừng (A → X → B)
- 2-stop: 2 điểm dừng (A → X → Y → B)

Ranking theo: giá + thời gian + độ tiện lợi
============================================================
*/

const pool = require('../config/db');
const QC = require('../queries/flight-combo.queries');
const { applyDynamicPricing } = require('../utils/pricing');
const seasonService = require('./season.service');

// Helpers

const VALID_SEAT_CLASSES = new Set(['economy', 'business', 'first']);
const VALID_SORT_OPTIONS = new Set(['recommended', 'price', 'duration']);

const normalizePassengers = ({ adults = 1, children = 0, infants = 0 }) => {
  const normalized = {
    adults: Math.max(1, parseInt(adults, 10) || 1),
    children: Math.max(0, parseInt(children, 10) || 0),
    infants: Math.max(0, parseInt(infants, 10) || 0),
  };

  if (normalized.infants > normalized.adults) {
    throw new Error('Số em bé không được nhiều hơn số người lớn'); // check lỗi lại
  }

  return normalized;
};

const validateMixedSearchParams = ({ from, to, outbound_date, return_date, seat_class, sort_by, max_stops }) => {
  if (!from || !to || !outbound_date) {
    throw new Error('Thieu tham so bat buoc: from, to, outbound_date');
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(outbound_date)) {
    throw new Error('outbound_date không hợp lệ (định dạng: YYYY-MM-DD)');
  }
  if (return_date && !dateRegex.test(return_date)) {
    throw new Error('return_date không hợp lệ (định dạng: YYYY-MM-DD)');
  }
  if (return_date && new Date(return_date) < new Date(outbound_date)) {
    throw new Error('return_date không được sớm hơn outbound_date');
  }
  if (seat_class && !VALID_SEAT_CLASSES.has(String(seat_class).toLowerCase())) {
    throw new Error('seat_class phải là economy, business hoặc first');
  }
  if (sort_by && !VALID_SORT_OPTIONS.has(String(sort_by).toLowerCase())) {
    throw new Error('sort_by phải là recommended, price hoặc duration');
  }
  const stops = parseInt(max_stops, 10);
  if (!Number.isNaN(stops) && (stops < 0 || stops > 2)) {
    throw new Error('max_stops phải nằm trong khoảng 0 đến 2');
  }
};

const sortCombosByPreference = (combos, sortBy) => {
  const normalized = String(sortBy || 'recommended').toLowerCase();
  if (normalized === 'price') {
    return [...combos].sort((a, b) => a.total_price - b.total_price);
  }
  if (normalized === 'duration') {
    return [...combos].sort((a, b) => a.total_duration_minutes - b.total_duration_minutes);
  }
  return rankCombos(combos);
};

// Tính thời gian dừng (layover) giữa 2 chuyến bay (phút)
const calcLayoverMinutes = (arrivalTime, departureTime) => {
  const arrival = new Date(arrivalTime).getTime();
  const departure = new Date(departureTime).getTime();
  return Math.round((departure - arrival) / 60000);
};

// Kiểm tra layover có hợp lệ không
const isValidLayover = (minutes) => {
  return minutes >= QC.MIN_LAYOVER_MINUTES && 
         minutes <= QC.MAX_LAYOVER_HOURS * 60;
};

// Cùng công thức với flight.service.js/recommendation.service.js
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

// Format 1 flight row → 1 leg object (with season pricing)
const formatLeg = async (row, adults, children, infants) => {
  const basePrice = parseFloat(row.base_price) || 0;
  const extraPrice = parseFloat(row.extra_baggage_price) || 0;
  const seasonInfo = await seasonService.getSeasonInfo(row.departure_time);
  const seasonMult = seasonInfo ? seasonInfo.multiplier : 1.0;
  const dynamicPrice = applyDynamicPricing(
    basePrice,
    row.available_seats,
    row.total_seats,
    row.departure_time,
    seasonMult
  );

  return {
    flight_id: row.flight_id,
    flight_number: row.flight_number,
    airline: {
      id: row.airline_id,
      code: row.airline_code,
      name: row.airline_name,
      logo: row.airline_logo,
    },
    departure: {
      airport_id: row.departure_airport_id,
      code: row.departure_code,
      city: row.departure_city,
      name: row.departure_airport_name,
      time: row.departure_time,
    },
    arrival: {
      airport_id: row.arrival_airport_id,
      code: row.arrival_code,
      city: row.arrival_city,
      name: row.arrival_airport_name,
      time: row.arrival_time,
    },
    duration_minutes: row.duration_minutes,
    season_info: seasonInfo,
    seat: {
      class: row.seat_class,
      available_seats: row.available_seats,
      base_price: dynamicPrice,
      total_price: calcTotalPrice(dynamicPrice, adults, children, infants),
      baggage_included_kg: row.baggage_included_kg,
      carry_on_kg: row.carry_on_kg,
      extra_baggage_price: extraPrice,
      extra_baggage_options: buildBaggageOptions(extraPrice),
    },
  };
};

// Tính tổng giá theo loại hành khách
const calcTotalPrice = (basePrice, adults, children, infants) => {
  const adultTotal = basePrice * adults;
  const childTotal = basePrice * 0.75 * children;
  const infantTotal = basePrice * 0.1 * infants;
  return Math.round(adultTotal + childTotal + infantTotal);
};

// Format 1 combo (gốc là 1 flight hoặc nhiều flights)
const formatCombo = (legs, direction, adults, children, infants) => {
  // Tinh tong gia tat ca legs
  const totalPrice = legs.reduce((sum, leg) => {
    return sum + (leg.seat?.total_price || 0);
  }, 0);

  // Tinh tong thoi gian bay
  const totalFlightDuration = legs.reduce((sum, leg) => {
    return sum + (leg.duration_minutes || 0);
  }, 0);

  // Tinh thoi gian dung
  let totalLayover = 0;
  for (let i = 1; i < legs.length; i++) {
    const layover = calcLayoverMinutes(legs[i - 1].arrival.time, legs[i].departure.time);
    totalLayover += layover;
  }

  // Lay danh sach airline
  const airlines = [...new Set(legs.map(l => l.airline.code))];

  // Thoi gian bat dau & ket thuc
  const departureTime = legs[0]?.departure?.time;
  const arrivalTime = legs[legs.length - 1]?.arrival?.time;

  return {
    stops: legs.length - 1,  // 0 = direct, 1 = 1-stop, 2 = 2-stop
    total_duration_minutes: totalFlightDuration + totalLayover,
    total_layover_minutes: totalLayover,
    total_price: totalPrice,
    airlines: airlines,
    departure_time: departureTime,
    arrival_time: arrivalTime,
    legs: legs,
  };
};

// ─── Tìm chuyến bay ───────────────────────────────

// Tìm chuyến bay trực tiếp (0 stop)
const findDirectFlights = async (from, to, date, seatClass, passengers) => {
  const seatsNeeded = passengers.adults + passengers.children;
  
  const result = await pool.query(QC.FIND_DIRECT_FLIGHTS, [
    from.toUpperCase(),
    to.toUpperCase(),
    seatClass.toLowerCase(),
    seatsNeeded,
    date,
  ]);

  const combos = await Promise.all(result.rows.map(async (row) => {
    const leg = await formatLeg(row, passengers.adults, passengers.children, passengers.infants);
    return formatCombo([leg], 'outbound', passengers.adults, passengers.children, passengers.infants);
  }));
  return combos;
};

// Tìm chuyến bay 1 stop (A → X → B)
const findOneStopFlights = async (from, to, date, seatClass, passengers) => {
  const seatsNeeded = passengers.adults + passengers.children;

  // Buoc 1: Tim tat ca chuyen bay di tu A
  const firstLegs = await pool.query(QC.FIND_FIRST_LEG, [
    from.toUpperCase(),
    seatClass.toLowerCase(),
    seatsNeeded,
    date,
  ]);

  // Map theo airport trung gian
  const intermediateAirports = [...new Set(firstLegs.rows.map(r => r.arrival_code))];
  const secondLegResults = await Promise.all(intermediateAirports.map(async (airport) => {
    const leg2Result = await pool.query(QC.FIND_SECOND_LEG, [
      airport,
      to.toUpperCase(),
      seatClass.toLowerCase(),
      seatsNeeded,
      date,
    ]);

    return [airport, leg2Result.rows];
  }));
  const secondLegMap = new Map(secondLegResults);
  const combos = [];

  for (const airport of intermediateAirports) {
    const leg1Options = firstLegs.rows.filter(r => r.arrival_code === airport);
    const leg2Rows = secondLegMap.get(airport) || [];

    if (leg2Rows.length === 0) continue;

    for (const leg1 of leg1Options) {
      for (const leg2 of leg2Rows) {
        const layover = calcLayoverMinutes(leg1.arrival_time, leg2.departure_time);
        if (!isValidLayover(layover)) continue;

        const [formattedLeg1, formattedLeg2] = await Promise.all([
          formatLeg(leg1, passengers.adults, passengers.children, passengers.infants),
          formatLeg(leg2, passengers.adults, passengers.children, passengers.infants),
        ]);

        combos.push(formatCombo(
          [formattedLeg1, formattedLeg2],
          'outbound',
          passengers.adults,
          passengers.children,
          passengers.infants
        ));
      }
    }
  }

  return combos;
};

// Tìm chuyến bay 2 stop (A → X → Y → B)
const findTwoStopFlights = async (from, to, date, seatClass, passengers) => {
  const seatsNeeded = passengers.adults + passengers.children;
  const combos = [];

  // Tim chuyen bay buoc 1 tu A
  const firstLegs = await pool.query(QC.FIND_FIRST_LEG_2STOP, [
    from.toUpperCase(),
    seatClass.toLowerCase(),
    seatsNeeded,
    date,
  ]);

  // voi moi buoc 1, tim buoc 2
  for (const leg1 of firstLegs.rows) {
    const midAirport = leg1.arrival_code;
    if (midAirport === to.toUpperCase()) continue; // Khong dung lai o dich vu

    // Tim chuyen bay buoc 2 tu midAirport
    const midLegs = await pool.query(QC.FIND_MID_LEG, [
      midAirport,
      seatClass.toLowerCase(),
      seatsNeeded,
      date,
      to.toUpperCase(), // Khong den thang dich vu
    ]);

    for (const leg2 of midLegs.rows) {
      const lastAirport = leg2.arrival_code;
      if (lastAirport === to.toUpperCase()) continue;

      const layover1 = calcLayoverMinutes(leg1.arrival_time, leg2.departure_time);
      if (!isValidLayover(layover1)) continue;

      // Tim chuyen bay cuoi
      const lastLegs = await pool.query(QC.FIND_LAST_LEG, [
        lastAirport,
        to.toUpperCase(),
        seatClass.toLowerCase(),
        seatsNeeded,
        date,
      ]);

      for (const leg3 of lastLegs.rows) {
        const layover2 = calcLayoverMinutes(leg2.arrival_time, leg3.departure_time);
        if (!isValidLayover(layover2)) continue;

        // Await all legs
        const formattedLeg1 = await formatLeg(leg1, passengers.adults, passengers.children, passengers.infants);
        const formattedLeg2 = await formatLeg(leg2, passengers.adults, passengers.children, passengers.infants);
        const formattedLeg3 = await formatLeg(leg3, passengers.adults, passengers.children, passengers.infants);

        combos.push(formatCombo(
          [formattedLeg1, formattedLeg2, formattedLeg3],
          'outbound',
          passengers.adults,
          passengers.children,
          passengers.infants
        ));
      }
    }
  }

  return combos;
};

// ─── Tìm combos theo chiều ──────────────────────

// Tìm tất cả combos cho 1 chiều (direct + 1-stop + 2-stop)
const findAllCombosForDirection = async (from, to, date, seatClass, passengers, maxStops = 2) => {
  const combos = [];

  // Tim direct (0 stop)
  if (maxStops >= 0) {
    const direct = await findDirectFlights(from, to, date, seatClass, passengers);
    combos.push(...direct);
  }

  // Tim 1 stop
  if (maxStops >= 1) {
    const oneStop = await findOneStopFlights(from, to, date, seatClass, passengers);
    combos.push(...oneStop);
  }

  // Tim 2 stop
  if (maxStops >= 2) {
    const twoStop = await findTwoStopFlights(from, to, date, seatClass, passengers);
    combos.push(...twoStop);
  }

  // Sort theo gia
  return combos.sort((a, b) => a.total_price - b.total_price);
};

// ─── Ranking ──────────────────────────────────

// Chấm điểm combo
const scoreCombo = (combo) => {
  let score = 0;

  // Giá thấp hơn tốt hơn
  score += combo.total_price * 0.4;

  // Thời gian tổng thấp hơn tốt hơn
  score += combo.total_duration_minutes * 0.3;

  // Thời gian dừng thấp hơn tốt hơn, nhưng phạt mạnh nếu ngoài ngưỡng hợp lệ
  score += combo.total_layover_minutes * 0.2;

  if (combo.airlines && combo.airlines.length > 1) {
    score -= 100;
  }

  if (combo.stops > 0 && combo.total_layover_minutes < QC.MIN_LAYOVER_MINUTES) {
    score += 9999;
  }
  if (combo.total_layover_minutes > QC.MAX_LAYOVER_HOURS * 60) {
    score += 500;
  }

  return score;
};

// Sắp xếp danh sách combos theo điểm
const rankCombos = (combos) => {
  return combos
    .map(c => ({ ...c, score: scoreCombo(c) }))
    .sort((a, b) => a.score - b.score);
};

// ─── Main API ──────────────────────────────────

// Tìm kiếm vé máy bay - kết hợp multi-leg + cross-airline
// @param {Object} params
// @param {string} params.from - Ma san bay di (VD: HAN)
// @param {string} params.to - Ma san bay den (VD: SGN)
// @param {string} params.outbound_date - Ngay di (YYYY-MM-DD)
// @param {string} params.return_date - Ngay ve (YYYY-MM-DD) - null neu one-way
// @param {number} params.adults - So nguoi lon
// @param {number} params.children - So tre em
// @param {number} params.infants - So em be
// @param {string} params.seat_class - economy | business | first
// @param {number} params.max_stops - So stop toi da (0, 1, 2)
// @param {number} params.limit - So ket qua toi da
// @param {string} params.sort_by - recommended | price | duration
const mixedSearch = async (params) => {
  const {
    from,
    to,
    outbound_date,
    return_date,
    adults = 1,
    children = 0,
    infants = 0,
    seat_class = 'economy',
    max_stops = 2,
    limit = 20,
    sort_by = 'recommended',
  } = params;

  validateMixedSearchParams({ from, to, outbound_date, return_date, seat_class, sort_by, max_stops });

  const passengers = normalizePassengers({ adults, children, infants });
  const parsedLimit = Math.max(1, parseInt(limit, 10) || 20);

  // ========== ONE-WAY ==========
  const oneWayOptions = await findAllCombosForDirection(
    from, to, outbound_date, seat_class, passengers, max_stops
  );

  // ========== ROUND-TRIP ==========
  let roundTripOptions = [];

  if (return_date) {
    const outboundCombos = sortCombosByPreference(oneWayOptions, 'recommended').slice(0, 15);
    const returnCombosRaw = await findAllCombosForDirection(
      to, from, return_date, seat_class, passengers, max_stops
    );
    const returnCombos = sortCombosByPreference(returnCombosRaw, 'recommended').slice(0, 15);

    roundTripOptions = [];

    for (const ob of outboundCombos) {
      for (const rt of returnCombos) {
        const totalPrice = ob.total_price + rt.total_price;
        const totalDuration = ob.total_duration_minutes + rt.total_duration_minutes;
        const totalLayover = ob.total_layover_minutes + rt.total_layover_minutes;
        const allAirlines = [...new Set([...ob.airlines, ...rt.airlines])];

        roundTripOptions.push({
          outbound: ob,
          return: rt,
          total_price: totalPrice,
          total_duration_minutes: totalDuration,
          total_layover_minutes: totalLayover,
          airlines: allAirlines,
          stops: ob.stops + rt.stops,
          stops_outbound: ob.stops,
          stops_return: rt.stops,
        });
      }
    }
  }

  // ========== APPLY SORT ==========
  const sortedOneWay = sortCombosByPreference(oneWayOptions, sort_by);
  const sortedRoundTrip = sortCombosByPreference(roundTripOptions, sort_by);

  // ========== RETURN ==========
  return {
    one_way_options: sortedOneWay.slice(0, parsedLimit),
    roundtrip_combinations: sortedRoundTrip.slice(0, parsedLimit),
    summary: {
      one_way_count: oneWayOptions.length,
      roundtrip_count: roundTripOptions.length,
      searched: {
        from,
        to,
        outbound_date,
        return_date,
        passengers,
        seat_class,
        max_stops,
      },
    },
  };
};

module.exports = {
  mixedSearch,
  findAllCombosForDirection,
  findDirectFlights,
  findOneStopFlights,
  findTwoStopFlights,
  rankCombos,
  calcLayoverMinutes,
  isValidLayover,
};
