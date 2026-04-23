const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../../src/services/flight.service.js');
const dbPath = path.resolve(__dirname, '../../src/config/db.js');

function loadFlightService(queryImpl) {
  delete require.cache[servicePath];
  delete require.cache[dbPath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      query: queryImpl || (async () => ({ rows: [] })),
    },
  };

  return require(servicePath);
}

test('searchFlights: báo lỗi nếu điểm đi và điểm đến trùng nhau', async () => {
  const flightService = loadFlightService();
  await assert.rejects(
    () => flightService.searchFlights({
      departure_code: 'SGN',
      arrival_code: 'SGN',
      departure_date: '2099-12-31',
      seat_class: 'economy',
    }),
    /Điểm đi và điểm đến không được trùng nhau/
  );
});

test('searchFlights: báo lỗi nếu seat_class không hợp lệ', async () => {
  const flightService = loadFlightService();
  await assert.rejects(
    () => flightService.searchFlights({
      departure_code: 'SGN',
      arrival_code: 'HAN',
      departure_date: '2099-12-31',
      seat_class: 'premium',
    }),
    /seat_class phải là một trong/
  );
});

test('searchFlights: trả danh sách chuyến bay đã format đúng', async () => {
  let calls = 0;
  const flightService = loadFlightService(async () => {
    calls += 1;
    return {
      rows: [
        {
          flight_id: 99,
          flight_number: 'VN123',
          status: 'scheduled',
          airline_id: 1,
          airline_code: 'VN',
          airline_name: 'Vietnam Airlines',
          airline_logo: 'logo.png',
          departure_airport_id: 10,
          departure_code: 'SGN',
          departure_airport_name: 'Tan Son Nhat',
          departure_city: 'Ho Chi Minh',
          departure_time: '2099-12-31T08:00:00.000Z',
          arrival_airport_id: 11,
          arrival_code: 'HAN',
          arrival_airport_name: 'Noi Bai',
          arrival_city: 'Ha Noi',
          arrival_time: '2099-12-31T10:00:00.000Z',
          duration_minutes: 120,
          seat_class: 'economy',
          available_seats: 9,
          total_seats: 20,
          base_price: 100,
          baggage_included_kg: 20,
          carry_on_kg: 7,
          extra_baggage_price: 2,
          extra_baggage_options: { 0: 0, 5: 120000, 10: 210000, 20: 380000 },
        },
      ],
    };
  });

  const result = await flightService.searchFlights({
    departure_code: 'SGN',
    arrival_code: 'HAN',
    departure_date: '2099-12-31',
    adults: 1,
    children: 1,
    infants: 0,
    seat_class: 'economy',
  });

  assert.equal(calls, 1);
  assert.equal(result.outbound_flights.length, 1);
  assert.equal(result.outbound_flights[0].flight_number, 'VN123');
  assert.equal(result.outbound_flights[0].seat.total_price, 175);
  assert.equal(result.outbound_flights[0].seat.price_breakdown.child_price, 75);
  assert.equal(result.outbound_flights[0].seat.extra_baggage_options.length, 4);
  assert.equal(result.outbound_flights[0].seat.extra_baggage_options[1].price_per_person, 120000);
  assert.equal(result.outbound_flights[0].seat.extra_baggage_options[2].price_per_person, 210000);
});
