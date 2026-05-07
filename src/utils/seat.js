const QS = require("../queries/seat.queries");

/**
 * Tự động sinh số ghế cho hành khách
 * Format: <row><col> — VD: 1A, 12C, 33F
 *
 * Layout theo hạng:
 *   first:    1-10,  2 ghế/hàng  (A, C)                → 20 ghế/10 hàng
 *   business: 1-20,  4 ghế/hàng  (A, C, D, F)          → 80 ghế/20 hàng
 *   economy:  1-50,  6 ghế/hàng  (A, B, C, D, E, F)    → 300 ghế/50 hàng
 */

const SEAT_COLS = {
  first:    ["A", "C"],
  business: ["A", "C", "D", "F"],
  economy:  ["A", "B", "C", "D", "E", "F"],
};

/**
 * Sinh danh sách tất cả số ghế có thể của 1 hạng
 * @param {string} seatClass - economy | business | first
 * @param {number} totalSeats - tổng số ghế
 */
const generateAllSeats = (seatClass, totalSeats) => {
  const cols  = SEAT_COLS[seatClass] || SEAT_COLS.economy;
  const seats = [];
  let   row   = 1;

  while (seats.length < totalSeats) {
    for (const col of cols) {
      if (seats.length >= totalSeats) break;
      seats.push(`${row}${col}`);
    }
    row++;
  }

  return seats;
};

/**
 * Lấy số ghế tiếp theo chưa bị chiếm trong chuyến bay
 * @param {object} client - pg client (trong transaction)
 * @param {number} flightId
 * @param {string} seatClass
 * @param {number} totalSeats - tổng ghế của hạng này (để biết range)
 */
const getNextAvailableSeat = async (client, flightId, seatClass, totalSeats) => {
  // Lấy danh sách ghế đã bị chiếm
  const occupied = await client.query(QS.SELECT_OCCUPIED_SEATS, [flightId, seatClass]);

  const occupiedSet = new Set(occupied.rows.map(r => r.seat_number));
  const allSeats    = generateAllSeats(seatClass, totalSeats);

  // Tìm ghế đầu tiên chưa bị chiếm
  for (const seat of allSeats) {
    if (!occupiedSet.has(seat)) return seat;
  }

  return null; // Hết ghế (không nên xảy ra nếu check available_seats đúng)
};

/**
 * Gán số ghế cho hành khách và lưu vào DB
 * @param {object} client - pg client
 * @param {number} flightId
 * @param {string} seatClass
 * @param {number} totalSeats
 * @param {number} passengerId
 * @param {number} bookingId
 * @returns {string} seat_number được gán
 */
const assignSeat = async (client, flightId, seatClass, totalSeats, passengerId, bookingId) => {
  const seatNumber = await getNextAvailableSeat(client, flightId, seatClass, totalSeats);

  if (!seatNumber) throw new Error(`Không còn ghế trống hạng ${seatClass} cho chuyến bay ID ${flightId}`);

  // Lưu vào bảng flight_seat_assignments
  await client.query(QS.INSERT_SEAT_ASSIGNMENT, [flightId, seatNumber, seatClass, passengerId, bookingId]);

  // Cập nhật seat_number vào passengers
  await client.query(QS.UPDATE_PASSENGER_SEAT, [seatNumber, passengerId]);

  return seatNumber;
};

module.exports = { generateAllSeats, getNextAvailableSeat, assignSeat };