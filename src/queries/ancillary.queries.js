"use strict";

// Lấy tất cả dịch vụ bổ sung đang active (có thể filter theo type)
const GET_ANCILLARY_OPTIONS = `
  SELECT id, type, name, description, price, unit, meta, is_active
  FROM ancillary_options
  WHERE is_active = TRUE
    AND ($1::varchar IS NULL OR type = $1)
  ORDER BY type ASC, price ASC
`;

// Lấy 1 option theo ID
const GET_ANCILLARY_OPTION_BY_ID = `
  SELECT id, type, name, description, price, unit, meta, is_active
  FROM ancillary_options
  WHERE id = $1
`;

// Lấy tất cả ancillaries của 1 booking
const GET_ANCILLARIES_BY_BOOKING = `
  SELECT
    ba.id,
    ba.passenger_id,
    ba.flight_type,
    ba.quantity,
    ba.unit_price,
    ba.total_price,
    ba.status,
    ba.created_at,
    p.full_name        AS passenger_name,
    p.passenger_type,
    ao.id              AS option_id,
    ao.type            AS service_type,
    ao.name            AS service_name,
    ao.description     AS service_description,
    ao.unit,
    ao.meta
  FROM booking_ancillaries ba
  JOIN passengers         p  ON p.id  = ba.passenger_id
  JOIN ancillary_options  ao ON ao.id = ba.ancillary_option_id
  WHERE ba.booking_id = $1
    AND ba.status != 'cancelled'
  ORDER BY ba.flight_type ASC, p.id ASC, ao.type ASC
`;

// Kiểm tra hành khách có thuộc booking không
const CHECK_PASSENGER_IN_BOOKING = `
  SELECT p.id, p.passenger_type, p.flight_type
  FROM passengers p
  WHERE p.id = $1 AND p.booking_id = $2
`;

// Kiểm tra đã chọn dịch vụ này chưa (tránh duplicate)
const CHECK_DUPLICATE_ANCILLARY = `
  SELECT id FROM booking_ancillaries
  WHERE booking_id          = $1
    AND passenger_id        = $2
    AND ancillary_option_id = $3
    AND flight_type         = $4
    AND status             != 'cancelled'
`;

// Thêm dịch vụ bổ sung
const INSERT_ANCILLARY = `
  INSERT INTO booking_ancillaries
    (booking_id, passenger_id, ancillary_option_id, flight_type, quantity, unit_price, total_price)
  VALUES ($1, $2, $3, $4, $5, $6, $7)
  RETURNING *
`;

// Huỷ 1 dịch vụ bổ sung
const CANCEL_ANCILLARY = `
  UPDATE booking_ancillaries
  SET status = 'cancelled', updated_at = NOW()
  WHERE id = $1 AND booking_id = $2
  RETURNING *
`;

// Tổng tiền ancillaries của booking (chưa cancelled)
const GET_ANCILLARY_TOTAL = `
  SELECT COALESCE(SUM(total_price), 0) AS ancillary_total
  FROM booking_ancillaries
  WHERE booking_id = $1 AND status != 'cancelled'
`;

module.exports = {
  GET_ANCILLARY_OPTIONS,
  GET_ANCILLARY_OPTION_BY_ID,
  GET_ANCILLARIES_BY_BOOKING,
  CHECK_PASSENGER_IN_BOOKING,
  CHECK_DUPLICATE_ANCILLARY,
  INSERT_ANCILLARY,
  CANCEL_ANCILLARY,
  GET_ANCILLARY_TOTAL,
};