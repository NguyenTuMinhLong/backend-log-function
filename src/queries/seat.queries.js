"use strict";

/*
=========================================================
SQL queries for SEAT MANAGEMENT
- flight_seat_assignments
- seat_pricing
- passengers
=========================================================
*/

// =========================================================
// SEAT ASSIGNMENT QUERIES
// =========================================================

const SELECT_OCCUPIED_SEATS = `
  SELECT seat_number
  FROM flight_seat_assignments
  WHERE flight_id = $1 AND class = $2`;

const INSERT_SEAT_ASSIGNMENT = `
  INSERT INTO flight_seat_assignments
     (flight_id, seat_number, class, status, passenger_id, booking_id)
   VALUES ($1, $2, $3, 'occupied', $4, $5)
   ON CONFLICT (flight_id, seat_number) DO NOTHING`;

const UPDATE_PASSENGER_SEAT = `
  UPDATE passengers SET seat_number = $1 WHERE id = $2`;

const UPDATE_BOOKING_SEAT_SELECTION = `
  UPDATE bookings 
  SET seat_selection_type = $1, seat_extra_fee = $2, updated_at = NOW()
  WHERE id = $3`;

// =========================================================
// SEAT PRICING QUERIES
// =========================================================

const SELECT_SEAT_PRICING = `
  SELECT id, seat_class, position, extra_price
  FROM seat_pricing
  WHERE (flight_id = $1 OR flight_id IS NULL) AND is_active = true
  ORDER BY seat_class, position`;

const SELECT_SEAT_PRICING_BY_CLASS = `
  SELECT position, extra_price
  FROM seat_pricing
  WHERE (flight_id = $1 OR flight_id IS NULL) 
    AND seat_class = $2 
    AND is_active = true
  ORDER BY extra_price DESC`;

// =========================================================
// SEAT MAP QUERIES - Get all seats with availability
// =========================================================

const SELECT_SEAT_MAP = `
  SELECT 
    fsa.seat_number,
    fsa.class,
    fsa.status,
    fsa.passenger_id,
    fsa.booking_id,
    -- Don gian hoa: Chi window (A, F) hoac standard
    CASE 
      WHEN fsa.seat_number ~ '[AF]$' THEN 'window'
      ELSE 'standard'
    END as position,
    COALESCE(
      (SELECT sp.extra_price FROM seat_pricing sp 
       WHERE (sp.flight_id = $1 OR sp.flight_id IS NULL) 
         AND sp.seat_class = fsa.class 
         AND sp.position = CASE 
              WHEN fsa.seat_number ~ '[AF]$' THEN 'window'
              ELSE 'standard'
            END
       ORDER BY sp.flight_id DESC NULLS LAST LIMIT 1),
      0
    ) as extra_price
  FROM flight_seat_assignments fsa
  WHERE fsa.flight_id = $1 AND fsa.class = $2
  ORDER BY fsa.seat_number`;

const SELECT_SEAT_MAP_SUMMARY = `
  SELECT 
    class,
    COUNT(*) as total,
    COUNT(CASE WHEN status = 'available' THEN 1 END) as available,
    COUNT(CASE WHEN status = 'occupied' THEN 1 END) as occupied
  FROM flight_seat_assignments
  WHERE flight_id = $1
  GROUP BY class`;

const UPDATE_SEAT_STATUS = `
  UPDATE flight_seat_assignments 
  SET status = $1, passenger_id = $2, booking_id = $3, updated_at = NOW()
  WHERE flight_id = $4 AND seat_number = $5`;

const RELEASE_SEAT = `
  UPDATE flight_seat_assignments 
  SET status = 'available', passenger_id = NULL, booking_id = NULL, updated_at = NOW()
  WHERE flight_id = $1 AND seat_number = $2`;

// =========================================================
// CHECKIN QUERIES
// =========================================================

const INSERT_CHECKIN = `
  INSERT INTO checkins 
    (booking_id, passenger_id, flight_type, boarding_pass_code, sequence_number, gate, boarding_time)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *`;

const UPDATE_PASSENGER_CHECKIN_STATUS = `
  UPDATE passengers 
  SET checked_in = true, checked_in_at = NOW()
  WHERE id = $1`;

const SELECT_CHECKIN_BY_BOOKING = `
  SELECT 
    c.id, c.boarding_pass_code, c.sequence_number, c.flight_type,
    c.checked_in_at, c.status, c.gate, c.boarding_time,
    p.id as passenger_id, p.full_name, p.seat_number, p.passenger_type
  FROM checkins c
  JOIN passengers p ON p.id = c.passenger_id
  WHERE c.booking_id = $1`;

const SELECT_CHECKIN_BY_CODE = `
  SELECT 
    c.id, c.boarding_pass_code, c.sequence_number, c.flight_type,
    c.checked_in_at, c.status, c.gate, c.boarding_time,
    p.id as passenger_id, p.full_name, p.seat_number, p.passenger_type,
    b.booking_code, b.trip_type,
    f.flight_number, f.departure_city, f.arrival_city,
    f.departure_time, f.arrival_time,
    f.departure_airport, f.arrival_airport
  FROM checkins c
  JOIN passengers p ON p.id = c.passenger_id
  JOIN bookings b ON b.id = c.booking_id
  JOIN flights f ON f.id = CASE 
    WHEN c.flight_type = 'outbound' THEN b.outbound_flight_id 
    ELSE b.return_flight_id
  END
  WHERE c.boarding_pass_code = $1`;

const CHECK_BOOKING_CHECKIN_STATUS = `
  SELECT 
    b.id as booking_id,
    b.booking_code,
    b.status as booking_status,
    b.departure_time,
    COUNT(p.id) as total_passengers,
    COUNT(CASE WHEN p.checked_in = true THEN 1 END) as checked_in_passengers
  FROM bookings b
  LEFT JOIN passengers p ON p.booking_id = b.id
  WHERE b.booking_code = $1
  GROUP BY b.id`;

const CHECK_PASSENGER_CHECKIN = `
  SELECT checked_in, seat_number 
  FROM passengers 
  WHERE booking_id = $1 AND id = $2`;

const GET_NEXT_SEQUENCE_NUMBER = `
  SELECT COALESCE(MAX(sequence_number), 0) + 1 as next_seq
  FROM checkins
  WHERE booking_id = $1 AND flight_type = $2`;

const GET_BOOKING_DETAILS_FOR_CHECKIN = `
  SELECT 
    b.id, b.booking_code, b.trip_type, b.status,
    b.outbound_flight_id, b.return_flight_id,
    b.outbound_seat_class, b.return_seat_class,
    b.gate, b.boarding_time,
    f_out.flight_number as outbound_flight_number,
    f_out.departure_city as outbound_departure,
    f_out.arrival_city as outbound_arrival,
    f_out.departure_time as outbound_departure_time,
    f_out.arrival_time as outbound_arrival_time,
    f_out.departure_airport as outbound_departure_airport,
    f_out.arrival_airport as outbound_arrival_airport,
    f_ret.flight_number as return_flight_number,
    f_ret.departure_city as return_departure,
    f_ret.arrival_city as return_arrival,
    f_ret.departure_time as return_departure_time,
    f_ret.arrival_time as return_arrival_time,
    f_ret.departure_airport as return_departure_airport,
    f_ret.arrival_airport as return_arrival_airport
  FROM bookings b
  LEFT JOIN flights f_out ON f_out.id = b.outbound_flight_id
  LEFT JOIN flights f_ret ON f_ret.id = b.return_flight_id
  WHERE b.booking_code = $1`;

const GET_PASSENGERS_FOR_CHECKIN = `
  SELECT 
    p.id, p.full_name, p.seat_number, p.passenger_type,
    p.checked_in, p.checked_in_at,
    c.boarding_pass_code, c.sequence_number, c.status as checkin_status
  FROM passengers p
  LEFT JOIN checkins c ON c.passenger_id = p.id AND c.flight_type = $2
  WHERE p.booking_id = $1
  ORDER BY p.passenger_type, p.full_name`;

const UPDATE_BOOKING_GATE = `
  UPDATE bookings SET gate = $1, updated_at = NOW() WHERE id = $2`;

const UPDATE_BOOKING_BOARDING_TIME = `
  UPDATE bookings SET boarding_time = $1, updated_at = NOW() WHERE id = $2`;

module.exports = {
  // Seat Assignment
  SELECT_OCCUPIED_SEATS,
  INSERT_SEAT_ASSIGNMENT,
  UPDATE_PASSENGER_SEAT,
  UPDATE_BOOKING_SEAT_SELECTION,
  
  // Seat Pricing
  SELECT_SEAT_PRICING,
  SELECT_SEAT_PRICING_BY_CLASS,
  
  // Seat Map
  SELECT_SEAT_MAP,
  SELECT_SEAT_MAP_SUMMARY,
  UPDATE_SEAT_STATUS,
  RELEASE_SEAT,
  
  // Checkin
  INSERT_CHECKIN,
  UPDATE_PASSENGER_CHECKIN_STATUS,
  SELECT_CHECKIN_BY_BOOKING,
  SELECT_CHECKIN_BY_CODE,
  CHECK_BOOKING_CHECKIN_STATUS,
  CHECK_PASSENGER_CHECKIN,
  GET_NEXT_SEQUENCE_NUMBER,
  GET_BOOKING_DETAILS_FOR_CHECKIN,
  GET_PASSENGERS_FOR_CHECKIN,
  UPDATE_BOOKING_GATE,
  UPDATE_BOOKING_BOARDING_TIME,
};
