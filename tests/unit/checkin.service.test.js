'use strict';

// MOCKS


const mockClient = { query: jest.fn(), release: jest.fn() };

jest.mock('../../src/config/db', () => ({
  connect: jest.fn(),
  query: jest.fn(),
}));

jest.mock('../../src/queries/seat.queries', () => ({
  CHECK_BOOKING_CHECKIN_STATUS:    'CHECK_BOOKING_CHECKIN_STATUS',
  GET_PASSENGERS_FOR_CHECKIN:      'GET_PASSENGERS_FOR_CHECKIN',
  GET_BOOKING_DETAILS_FOR_CHECKIN: 'GET_BOOKING_DETAILS_FOR_CHECKIN',
  GET_NEXT_SEQUENCE_NUMBER:        'GET_NEXT_SEQUENCE_NUMBER',
  INSERT_CHECKIN:                  'INSERT_CHECKIN',
  UPDATE_PASSENGER_CHECKIN_STATUS: 'UPDATE_PASSENGER_CHECKIN_STATUS',
  SELECT_CHECKIN_BY_CODE:          'SELECT_CHECKIN_BY_CODE',
  UPDATE_BOOKING_GATE:             'UPDATE_BOOKING_GATE',
}));

const db = require('../../src/config/db');
const {
  checkBookingCheckinStatus,
  checkinPassenger,
  checkinAllPassengers,
  getBoardingPass,
  generateBoardingPassCode,
  formatDate,
  formatTime,
  CHECKIN_CONFIG,
} = require('../../src/services/checkin.service');

// FACTORIES
const future = (h = 10) => new Date(Date.now() + h * 3600000).toISOString();
const past   = ()       => new Date(Date.now() - 3600000).toISOString();

const makeBooking = (o = {}) => ({
  id: 1, booking_code: 'VJ8PKSL',
  outbound_flight_id: 10, return_flight_id: null,
  departure_time: future(10), gate: 'A1',
  status: 'confirmed', ...o,
});

const makePassenger = (o = {}) => ({
  id: 1, full_name: 'Nguyen Van A',
  passenger_type: 'adult', booking_id: 1,
  seat_number: '12A', return_seat_number: null,
  checked_in: false, ...o,
});

// Setup pool.query sequence (for non-transaction calls)
const poolSeq = (...rows) => {
  let i = 0;
  db.query.mockImplementation(() => Promise.resolve(rows[i++] ?? { rows: [] }));
};

// Setup client.query sequence (for transaction calls)
const clientSeq = (...rows) => {
  let i = 0;
  mockClient.query.mockImplementation(() => Promise.resolve(rows[i++] ?? { rows: [] }));
};

beforeEach(() => {
  jest.clearAllMocks();
  db.connect.mockResolvedValue(mockClient);
  mockClient.release.mockReturnValue(undefined);
});

// PURE HELPERS

describe('Helpers', () => {
  it('generateBoardingPassCode — đúng format', () => {
    expect(generateBoardingPassCode('VJ8PKSL', 1)).toBe('VJ8PKSL-P1');
  });

  it('formatDate — trả về string ngày (không rỗng)', () => {
    expect(formatDate(future())).toMatch(/\d{2} \w+ \d{4}/i);
  });

  it('formatTime — trả về HH:MM', () => {
    expect(formatTime(future())).toMatch(/^\d{2}:\d{2}$/);
  });
});

// checkBookingCheckinStatus

describe('checkBookingCheckinStatus', () => {
  it('throws nếu booking không tồn tại', async () => {
    poolSeq({ rows: [] });
    await expect(checkBookingCheckinStatus('XXXX')).rejects.toThrow('Booking khong ton tai');
  });

  it('throws nếu booking chưa confirmed', async () => {
    poolSeq({ rows: [{ booking_status: 'pending', departure_time: future(10) }] });
    await expect(checkBookingCheckinStatus('BK')).rejects.toThrow('chua duoc xac nhan');
  });

  it('throws nếu chuyến bay đã khởi hành', async () => {
    poolSeq({ rows: [{ booking_status: 'confirmed', departure_time: past() }] });
    await expect(checkBookingCheckinStatus('BK')).rejects.toThrow('da khoi hanh');
  });

  it('throws nếu check-in quá sớm (> 24h)', async () => {
    poolSeq({ rows: [{ booking_status: 'confirmed', departure_time: future(30) }] });
    await expect(checkBookingCheckinStatus('BK')).rejects.toThrow('check-in sau');
  });

  it('throws nếu check-in quá muộn (< 30 phút)', async () => {
    poolSeq({ rows: [{ booking_status: 'confirmed', departure_time: future(0.3) }] });
    await expect(checkBookingCheckinStatus('BK')).rejects.toThrow('Qua muon');
  });

  it('pass nếu trong thời gian cho phép', async () => {
    const booking = { booking_status: 'confirmed', departure_time: future(10) };
    poolSeq({ rows: [booking] });
    await expect(checkBookingCheckinStatus('BK')).resolves.toEqual(booking);
  });
});

// checkinPassenger
describe('checkinPassenger', () => {
  it('throws nếu booking không tồn tại', async () => {
    clientSeq({ rows: [] }, { rows: [] }); // BEGIN + SELECT booking
    await expect(checkinPassenger('BK', 1, 'outbound')).rejects.toThrow('Booking khong ton tai');
  });

  it('throws nếu passenger không thuộc booking', async () => {
    clientSeq({ rows: [] }, { rows: [makeBooking()] }, { rows: [] });
    await expect(checkinPassenger('BK', 99, 'outbound')).rejects.toThrow('Hanh khach khong ton tai');
  });

  it('throws nếu passenger đã check-in', async () => {
    clientSeq(
      { rows: [] },                            // BEGIN
      { rows: [makeBooking()] },               // booking
      { rows: [makePassenger({ checked_in: true })] },
    );
    await expect(checkinPassenger('BK', 1, 'outbound')).rejects.toThrow('da check-in roi');
  });

  it('throws nếu passenger chưa có ghế', async () => {
    clientSeq(
      { rows: [] },
      { rows: [makeBooking()] },
      { rows: [makePassenger({ seat_number: null })] },
    );
    await expect(checkinPassenger('BK', 1, 'outbound')).rejects.toThrow('chua co ghe');
  });

  it('check-in thành công — trả về boarding pass info', async () => {
    clientSeq(
      { rows: [] },                          // BEGIN
      { rows: [makeBooking()] },             // booking
      { rows: [makePassenger()] },           // passenger
      { rows: [{ flight_number: 'VJ123' }] },// flight
      { rows: [{ next_seq: 1 }] },           // sequence
      { rows: [] },                          // INSERT_CHECKIN
      { rows: [] },                          // UPDATE_PASSENGER
      { rows: [] },                          // COMMIT
    );

    const result = await checkinPassenger('VJ8PKSL', 1, 'outbound');
    expect(result.success).toBe(true);
    expect(result.boarding_pass_code).toBe('VJ8PKSL-P1');
    expect(result.seat_number).toBe('12A');
    expect(result.flight_number).toBe('VJ123');
  });

  it('rollback khi có lỗi trong transaction', async () => {
    clientSeq({ rows: [] }, { rows: [makeBooking()] });
    mockClient.query.mockRejectedValueOnce(new Error('DB error'));

    await expect(checkinPassenger('BK', 1, 'outbound')).rejects.toThrow('DB error');
    expect(mockClient.query.mock.calls.map(c => c[0])).toContain('ROLLBACK');
  });
});

// checkinAllPassengers

describe('checkinAllPassengers', () => {
  it('throws nếu booking không tồn tại', async () => {
    clientSeq({ rows: [] }, { rows: [] });
    await expect(checkinAllPassengers('BK')).rejects.toThrow('Booking khong ton tai');
  });

  it('skip passenger đã check-in, vẫn xử lý người còn lại', async () => {
    const p1 = makePassenger({ id: 1, checked_in: true });
    const p2 = makePassenger({ id: 2, checked_in: false });

    clientSeq(
      { rows: [] },                              // BEGIN
      { rows: [makeBooking()] },                 // booking
      { rows: [p1, p2] },                        // passengers
      // p1 skipped (checked_in)
      { rows: [{ flight_number: 'VJ123' }] },    // flight for p2
      { rows: [{ next_seq: 1 }] },               // seq for p2
      { rows: [] },                              // INSERT_CHECKIN p2
      { rows: [] },                              // UPDATE_PASSENGER p2
      { rows: [] },                              // COMMIT
    );

    const result = await checkinAllPassengers('VJ8PKSL');
    expect(result.success).toBe(true);
    expect(result.passengers).toHaveLength(2);
    expect(result.passengers[0].error).toBe('Da check-in roi');
    expect(result.passengers[1].success).toBe(true);
  });

  it('skip passenger chưa có ghế', async () => {
    clientSeq(
      { rows: [] },
      { rows: [makeBooking()] },
      { rows: [makePassenger({ seat_number: null })] },
      { rows: [] }, // COMMIT
    );

    const result = await checkinAllPassengers('VJ8PKSL');
    expect(result.passengers[0].error).toBe('Chua co ghe ngoi');
  });

  it('checkin tất cả passenger thành công', async () => {
    const p1 = makePassenger({ id: 1 });
    const p2 = makePassenger({ id: 2, seat_number: '13B' });

    clientSeq(
      { rows: [] },
      { rows: [makeBooking()] },
      { rows: [p1, p2] },
      { rows: [{ flight_number: 'VJ123' }] }, { rows: [{ next_seq: 1 }] }, { rows: [] }, { rows: [] },
      { rows: [{ flight_number: 'VJ123' }] }, { rows: [{ next_seq: 2 }] }, { rows: [] }, { rows: [] },
      { rows: [] }, // COMMIT
    );

    const result = await checkinAllPassengers('VJ8PKSL');
    expect(result.passengers.every(p => p.success)).toBe(true);
  });
});

// getBoardingPass

describe('getBoardingPass', () => {
  it('throws nếu boarding pass không tồn tại', async () => {
    poolSeq({ rows: [] });
    await expect(getBoardingPass('INVALID')).rejects.toThrow('Boarding pass khong ton tai');
  });

  it('trả về boarding pass đầy đủ fields', async () => {
    poolSeq({ rows: [{
      full_name: 'Nguyen Van A', booking_code: 'VJ8PKSL',
      flight_number: 'VJ123', departure_time: future(5),
      boarding_time: future(4.5), gate: 'A1', seat_number: '12A',
      sequence_number: 1, boarding_pass_code: 'VJ8PKSL-P1',
      departure_city: 'HAN', arrival_city: 'SGN',
      departure_airport: 'HAN', arrival_airport: 'SGN',
    }] });

    const bp = await getBoardingPass('VJ8PKSL-P1');
    expect(bp.passenger_name).toBe('Nguyen Van A');
    expect(bp.seat).toBe('12A');
    expect(bp.gate).toBe('A1');
    expect(bp.qr_code_url).toContain('VJ8PKSL-P1');
    expect(bp.qr_data).toBeDefined();
  });

  it('dùng defaultGate nếu gate null', async () => {
    poolSeq({ rows: [{
      full_name: 'A', booking_code: 'BK', flight_number: 'VJ1',
      departure_time: future(5), boarding_time: null, gate: null,
      seat_number: '1A', sequence_number: 1, boarding_pass_code: 'BK-P1',
      departure_city: 'HAN', arrival_city: 'SGN',
      departure_airport: 'HAN', arrival_airport: 'SGN',
    }] });

    const bp = await getBoardingPass('BK-P1');
    expect(bp.gate).toBe(CHECKIN_CONFIG.defaultGate);
  });
});