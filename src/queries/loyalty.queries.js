'use strict';

/*
=========================================================
QUERIES: LOYALTY / MEMBERSHIP
=========================================================

Sync với loyalty.service.js — 3 cột điểm:
  lifetime_points   chỉ cộng, không bao giờ trừ
  tier_points       xét tier + cronjob penalty
  current_points    redeem được

Đã bỏ:
  total_points      → không dùng (đã remove)
  CALCULATE_NEXT_TIER → tier logic chuyển về TIERS config trong service

=========================================================
*/


// =========================================================
// MEMBERSHIP
// =========================================================

const GET_USER_LOYALTY = `
  SELECT
    ul.id,
    ul.user_id,
    ul.membership_number,
    ul.lifetime_points,
    ul.tier_points,
    ul.current_points,
    lt.name                  AS tier_name,
    lt.multiplier,
    lt.benefits,
    lt.rank_bages_url_light  AS badge_url_light,
    lt.rank_bages_url_dark   AS badge_url_dark

  FROM user_loyalty ul
  JOIN loyalty_tiers lt
    ON ul.tier_id = lt.id

  WHERE ul.user_id = $1
`;

const CREATE_USER_LOYALTY = `
  INSERT INTO user_loyalty (
    user_id,
    tier_id,
    membership_number,
    lifetime_points,
    tier_points,
    current_points
  )
  VALUES ($1, $2, $3, 0, 0, 0)
  RETURNING *
`;


// =========================================================
// TIER
// =========================================================

const GET_LOYALTY_TIER_BY_NAME = `
  SELECT id, name, min_points, multiplier, benefits
  FROM loyalty_tiers
  WHERE LOWER(name) = LOWER($1)
`;


// =========================================================
// POINTS
// =========================================================

/*
UPDATE_POINTS đã bỏ — service mới inline query trực tiếp
để kiểm soát chính xác từng cột theo từng action:

  earn           → cộng cả 3 cột
  redeem         → chỉ trừ current_points
  cancel/refund  → trừ tier + current (không trừ lifetime)
  cron           → chỉ trừ tier_points (không trừ current)
*/


// =========================================================
// TRANSACTIONS
// =========================================================

/*
type có thể là:
  'earn'    → tích điểm từ booking
  'redeem'  → đổi reward
  'revoke'  → trừ điểm do huỷ / refund booking
*/
const INSERT_TRANSACTION = `
  INSERT INTO loyalty_transactions (
    user_id,
    booking_id,
    type,
    amount,
    description
  )
  VALUES ($1, $2, $3, $4, $5)
`;

/*
$1 = user_id
$2 = limit  (mặc định truyền 20, frontend tự phân trang)
$3 = offset (page * limit)
*/
const GET_LOYALTY_HISTORY = `
  SELECT
    id,
    booking_id,
    type,
    amount   AS points,
    description,
    created_at

  FROM loyalty_transactions

  WHERE user_id = $1

  ORDER BY created_at DESC

  LIMIT  $2
  OFFSET $3
`;


// =========================================================
// REWARDS
// =========================================================

const GET_AVAILABLE_REWARDS = `
  SELECT
    id,
    name,
    description,
    points_required,
    discount_amount,
    is_active,
    COALESCE(category, 'voucher') AS category

  FROM loyalty_rewards

  WHERE is_active = true

  ORDER BY category ASC, points_required ASC
`;

const GET_REWARD_BY_ID = `
  SELECT
    id,
    name,
    description,
    points_required,
    discount_amount

  FROM loyalty_rewards

  WHERE id        = $1
    AND is_active = true
`;


// =========================================================
// EXPORTS
// =========================================================

module.exports = {

  // Membership
  GET_USER_LOYALTY,
  CREATE_USER_LOYALTY,

  // Tier
  GET_LOYALTY_TIER_BY_NAME,

  // Transactions
  INSERT_TRANSACTION,
  GET_LOYALTY_HISTORY,

  // Rewards
  GET_AVAILABLE_REWARDS,
  GET_REWARD_BY_ID,
};