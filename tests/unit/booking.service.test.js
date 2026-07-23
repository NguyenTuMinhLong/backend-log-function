const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const servicePath = path.resolve(__dirname, '../../src/services/booking.service.js');
const dbPath = path.resolve(__dirname, '../../src/config/db.js');
const seatPath = path.resolve(__dirname, '../../src/utils/seat.js');
const paymentServicePath = path.resolve(__dirname, '../../src/services/payment.service.js');

function loadBookingService() {
  delete require.cache[servicePath];
  delete require.cache[dbPath];
  delete require.cache[seatPath];
  delete require.cache[paymentServicePath];

  require.cache[dbPath] = {
    id: dbPath,
    filename: dbPath,
    loaded: true,
    exports: {
      connect: async () => {
        throw new Error('DB should not be called in validation-only tests');
      },
    },
  };

  require.cache[seatPath] = {
    id: seatPath,
    filename: seatPath,
    loaded: true,
    exports: { assignSeat: async () => 'A01' },
  };

  require.cache[paymentServicePath] = {
    id: paymentServicePath,
    filename: paymentServicePath,
    loaded: true,
    exports: { rollbackReservedVoucherUsageForBooking: async () => true },
  };

  return require(servicePath);
}

const basePayload = {
  outbound_flight_id: 1,
  outbound_seat_class: 'economy',
  trip_type: 'one_way',
  adults: 1,
  children: 0,
  infants: 0,
  contact_name: 'Naut',
  contact_email: 'naut@example.com',
  passengers: [
    {
      full_name: 'Huynh Nghiep Tuan',
      passenger_type: 'adult',
      flight_type: 'outbound',
      extra_baggage_kg: 0,
    },
  ],
};

test('createBooking: báo lỗi nếu thiếu outbound_flight_id', async () => {
  const bookingService = loadBookingService();
  const payload = { ...basePayload, outbound_flight_id: null };
  await assert.rejects(() => bookingService.createBooking(payload), /outbound_flight_id là bắt buộc/);
});

test('createBooking: báo lỗi nếu round_trip mà thiếu return_flight_id', async () => {
  const bookingService = loadBookingService();
  const payload = {
    ...basePayload,
    trip_type: 'round_trip',
    return_flight_id: null,
    return_seat_class: 'economy',
    passengers: [
      { full_name: 'Passenger 1', passenger_type: 'adult', flight_type: 'outbound' },
      { full_name: 'Passenger 1', passenger_type: 'adult', flight_type: 'return' },
    ],
  };
  await assert.rejects(() => bookingService.createBooking(payload), /return_flight_id là bắt buộc cho khứ hồi/);
});

test('createBooking: báo lỗi nếu số em bé nhiều hơn số người lớn', async () => {
  const bookingService = loadBookingService();
  const payload = {
    ...basePayload,
    adults: 1,
    infants: 2,
    passengers: [
      { full_name: 'Adult 1', passenger_type: 'adult', flight_type: 'outbound' },
      { full_name: 'Infant 1', passenger_type: 'infant', flight_type: 'outbound' },
      { full_name: 'Infant 2', passenger_type: 'infant', flight_type: 'outbound' },
    ],
  };
  await assert.rejects(() => bookingService.createBooking(payload), /Số em bé không được nhiều hơn số người lớn/);
});

test('createBooking: báo lỗi nếu số lượng hành khách không khớp', async () => {
  const bookingService = loadBookingService();
  const payload = {
    ...basePayload,
    adults: 2,
    passengers: [
      { full_name: 'Only one passenger', passenger_type: 'adult', flight_type: 'outbound' },
    ],
  };
  await assert.rejects(() => bookingService.createBooking(payload), /Số lượng hành khách không khớp/);
});
