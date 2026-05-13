"use strict";

/**
 * Queries cho Membership & Points
 */

const GET_USER_LOYALTY = `
  SELECT 
    ul.*,
    lt.name as tier_name,
    lt.multiplier,
    lt.benefits,
    lt.min_points as next_tier_min_points
  FROM user_loyalty ul
  JOIN loyalty_tiers lt ON ul.tier_id = lt.id
  WHERE ul.user_id = $1`;

const GET_LOYALTY_HISTORY = `
  SELECT 
    id, type, amount, description, created_at, booking_id
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
  GET_LOYALTY_HISTORY,
  CALCULATE_NEXT_TIER
};