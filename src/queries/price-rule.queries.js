"use strict";

// Lấy tất cả rules đang active cho 1 ngày cụ thể
// Dùng khi search flight để tính adjusted_price
const GET_ACTIVE_RULES_FOR_DATE = `
  SELECT
    id, name, type,
    adjustment_type, adjustment_value,
    applies_to_class,
    applies_to_airline_code,
    applies_to_departure_code,
    applies_to_arrival_code,
    priority
  FROM price_rules
  WHERE is_active    = TRUE
    AND start_date  <= $1::DATE
    AND end_date    >= $1::DATE
  ORDER BY priority DESC
`;

// CRUD cho admin
const GET_ALL_RULES = `
  SELECT * FROM price_rules
  ORDER BY start_date DESC, priority DESC
`;

const GET_RULE_BY_ID = `
  SELECT * FROM price_rules WHERE id = $1
`;

const INSERT_RULE = `
  INSERT INTO price_rules (
    name, type, start_date, end_date,
    adjustment_type, adjustment_value,
    applies_to_class, applies_to_airline_code,
    applies_to_departure_code, applies_to_arrival_code,
    priority, is_active, created_by
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'admin')
  RETURNING *
`;

const UPDATE_RULE = `
  UPDATE price_rules
  SET name                     = COALESCE($2,  name),
      type                     = COALESCE($3,  type),
      start_date               = COALESCE($4,  start_date),
      end_date                 = COALESCE($5,  end_date),
      adjustment_type          = COALESCE($6,  adjustment_type),
      adjustment_value         = COALESCE($7,  adjustment_value),
      applies_to_class         = $8,
      applies_to_airline_code  = $9,
      applies_to_departure_code= $10,
      applies_to_arrival_code  = $11,
      priority                 = COALESCE($12, priority),
      is_active                = COALESCE($13, is_active),
      updated_at               = NOW()
  WHERE id = $1
  RETURNING *
`;

const DELETE_RULE = `
  DELETE FROM price_rules WHERE id = $1 AND created_by = 'admin' RETURNING id
`;

const TOGGLE_RULE = `
  UPDATE price_rules SET is_active = NOT is_active, updated_at = NOW()
  WHERE id = $1 RETURNING id, name, is_active
`;

module.exports = {
  GET_ACTIVE_RULES_FOR_DATE,
  GET_ALL_RULES,
  GET_RULE_BY_ID,
  INSERT_RULE,
  UPDATE_RULE,
  DELETE_RULE,
  TOGGLE_RULE,
};