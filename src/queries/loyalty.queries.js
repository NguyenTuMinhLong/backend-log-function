"use strict";

/**
 * QUERIES cho Membership & Loyalty (khớp schema mới)
 */

const GET_USER_LOYALTY = `
  SELECT 
    ul.*,
    lt.name as tier_name,
    lt.multiplier,
    lt.benefits
  FROM user_loyalty ul
  JOIN loyalty_tiers lt ON ul.tier_id = lt.id
  WHERE ul.user_id = $1`;

const CREATE_USER_LOYALTY = `
  INSERT INTO user_loyalty (user_id, tier_id, membership_number)
  VALUES ($1, $2, $3)
  RETURNING *`;

const GET_LOYALTY_TIER_BY_NAME = `
  SELECT id FROM loyalty_tiers WHERE name = $1`;

const UPDATE_POINTS = `
  UPDATE user_loyalty 
  SET current_points = current_points + $2,
      total_points = total_points + $2,
      updated_at = NOW()
  WHERE user_id = $1`;

const INSERT_TRANSACTION = `
  INSERT INTO loyalty_transactions (user_id, booking_id, type, amount, description)
  VALUES ($1, $2, $3, $4, $5)`;

const GET_LOYALTY_HISTORY = `
  SELECT id, type, amount, description, created_at, booking_id
  FROM loyalty_transactions 
  WHERE user_id = $1 
  ORDER BY created_at DESC 
  LIMIT 5`;

const CALCULATE_NEXT_TIER = `
  SELECT name, min_points 
  FROM loyalty_tiers 
  WHERE min_points > $1 
  ORDER BY min_points ASC 
  LIMIT 1`;

module.exports = {
  GET_USER_LOYALTY,
  CREATE_USER_LOYALTY,
  GET_LOYALTY_TIER_BY_NAME,
  UPDATE_POINTS,
  INSERT_TRANSACTION,
  GET_LOYALTY_HISTORY,
  CALCULATE_NEXT_TIER
};