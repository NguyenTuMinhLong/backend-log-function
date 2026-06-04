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

// Helpers

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

// Format 1 flight row → 1 leg object
const formatLeg = (row, adults, children, infants) => {
  const basePrice = parseFloat(row.base_price) || 0;
  const dynamicPrice = applyDynamicPricing(
    basePrice,
    row.available_seats,
    row.total_seats,
    row.departure_time
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
    seat: {
      class: row.seat_class,
      available_seats: row.available_seats,
      base_price: dynamicPrice,
      total_price: calcTotalPrice(dynamicPrice, adults, children, infants),
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

  return result.rows.map(row => formatCombo(
    [formatLeg(row, passengers.adults, passengers.children, passengers.infants)],
    'outbound',
    passengers.adults,
    passengers.children,
    passengers.infants
  ));
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

  // Buoc 2: Tim tat ca chuyen bay den B
  const secondLegs = await pool.query(QC.FIND_SECOND_LEG, [
    'DUMMY', // Se thay the trong loop
    to.toUpperCase(),
    seatClass.toLowerCase(),
    seatsNeeded,
    date,
  ]);

  // Map theo airport trung gian
  const intermediateAirports = [...new Set(firstLegs.rows.map(r => r.arrival_code))];
  const combos = [];

  for (const airport of intermediateAirports) {
    // Tim chuyen bay buoc 1 den airport nay
    const leg1Options = firstLegs.rows.filter(r => r.arrival_code === airport);
    
    // Tim chuyen bay buoc 2 tu airport nay den B
    const leg2Result = await pool.query(QC.FIND_SECOND_LEG, [
      airport,
      to.toUpperCase(),
      seatClass.toLowerCase(),
      seatsNeeded,
      date,
    ]);

    if (leg2Result.rows.length === 0) continue;

    for (const leg1 of leg1Options) {
      for (const leg2 of leg2Result.rows) {
        const layover = calcLayoverMinutes(leg1.arrival_time, leg2.departure_time);
        
        // Kiem tra thoi gian dung hop le
        if (!isValidLayover(layover)) continue;

        combos.push(formatCombo(
          [
            formatLeg(leg1, passengers.adults, passengers.children, passengers.infants),
            formatLeg(leg2, passengers.adults, passengers.children, passengers.infants),
          ],
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

        combos.push(formatCombo(
          [
            formatLeg(leg1, passengers.adults, passengers.children, passengers.infants),
            formatLeg(leg2, passengers.adults, passengers.children, passengers.infants),
            formatLeg(leg3, passengers.adults, passengers.children, passengers.infants),
          ],
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

  // Gia (40%) - gia cao thi score cao (can convert ve negative)
  score += combo.total_price * 0.4;

  // Thoi gian bay (30%)
  score += combo.total_duration_minutes * 0.3;

  // Thoi gian dung (20%) - gap doi neu qua lau
  score += combo.total_layover_minutes * 0.2;

  // Diem thuong cho nhieu hang (vi linh hoat hon)
  if (combo.airlines && combo.airlines.length > 1) {
    score -= 100;
  }

  // Phat neu thoi gian dung qua ngan hoac qua lau
  if (combo.total_layover_minutes < QC.MIN_LAYOVER_MINUTES) {
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
 * 
 * @param {Object} params
 * @param {string} params.from - Ma san bay di (VD: HAN)
 * @param {string} params.to - Ma san bay den (VD: SGN)
 * @param {string} params.outbound_date - Ngay di (YYYY-MM-DD)
 * @param {string} params.return_date - Ngay ve (YYYY-MM-DD) - null neu one-way
 * @param {number} params.adults - So nguoi lon
 * @param {number} params.children - So tre em
 * @param {number} params.infants - So em be
 * @param {string} params.seat_class - economy | business | first
 * @param {number} params.max_stops - So stop toi da (0, 1, 2)
 * @param {number} params.limit - So ket qua toi da
 * @param {string} params.sort_by - recommended | price | duration
 */
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

  // Validate
  if (!from || !to || !outbound_date) {
    throw new Error('Thieu tham so bat buoc: from, to, outbound_date');
  }

  const passengers = {
    adults: parseInt(adults) || 1,
    children: parseInt(children) || 0,
    infants: parseInt(infants) || 0,
  };

  // ========== ONE-WAY ==========
  const oneWayOptions = await findAllCombosForDirection(
    from, to, outbound_date, seat_class, passengers, max_stops
  );

  // ========== ROUND-TRIP ==========
  let roundTripOptions = [];

  if (return_date) {
    // Tim tat ca outbound combos
    const outboundCombos = await findAllCombosForDirection(
      from, to, outbound_date, seat_class, passengers, max_stops
    );

    // Tim tat ca return combos
    const returnCombos = await findAllCombosForDirection(
      to, from, return_date, seat_class, passengers, max_stops
    );

    // Cross-product: moi outbound × moi return
    // Gioi han de tranh so luong qua lon
    const topOutbound = outboundCombos.slice(0, 30);
    const topReturn = returnCombos.slice(0, 30);

    roundTripOptions = [];

    for (const ob of topOutbound) {
      for (const rt of topReturn) {
        // Tinh tong gia & thoi gian
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
          stops_outbound: ob.stops,
          stops_return: rt.stops,
        });
      }
    }

    // Rank roundtrip
    roundTripOptions = roundTripOptions
      .map(c => ({
        ...c,
        score: scoreCombo({
          total_price: c.total_price,
          total_duration_minutes: c.total_duration_minutes,
          total_layover_minutes: c.total_layover_minutes,
          airlines: c.airlines,
        }),
      }))
      .sort((a, b) => a.score - b.score);
  }

  // ========== APPLY SORT ==========
  let sortedOneWay = [...oneWayOptions];
  let sortedRoundTrip = [...roundTripOptions];

  if (sort_by === 'price') {
    sortedOneWay.sort((a, b) => a.total_price - b.total_price);
    sortedRoundTrip.sort((a, b) => a.total_price - b.total_price);
  } else if (sort_by === 'duration') {
    sortedOneWay.sort((a, b) => a.total_duration_minutes - b.total_duration_minutes);
    sortedRoundTrip.sort((a, b) => a.total_duration_minutes - b.total_duration_minutes);
  }
  // sort_by = 'recommended' da dung score sort o tren

  // ========== RETURN ==========
  return {
    one_way_options: sortedOneWay.slice(0, parseInt(limit)),
    roundtrip_combinations: sortedRoundTrip.slice(0, parseInt(limit)),
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
