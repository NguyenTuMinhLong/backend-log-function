"use strict";

/**
 * SQL queries liên quan đến bảng flight_seat_assignments, passengers
 * Được dùng bởi: utils/seat.js
 */

const SELECT_OCCUPIED_SEATS =
  `SELECT seat_number
   FROM flight_seat_assignments
   WHERE flight_id = $1 AND class = $2`;

const INSERT_SEAT_ASSIGNMENT =
  `INSERT INTO flight_seat_assignments
     (flight_id, seat_number, class, status, passenger_id, booking_id)
   VALUES ($1, $2, $3, 'occupied', $4, $5)
   ON CONFLICT (flight_id, seat_number) DO NOTHING`;

const UPDATE_PASSENGER_SEAT =
  `UPDATE passengers SET seat_number = $1 WHERE id = $2`;

module.exports = {
  SELECT_OCCUPIED_SEATS,
  INSERT_SEAT_ASSIGNMENT,
  UPDATE_PASSENGER_SEAT,
};
