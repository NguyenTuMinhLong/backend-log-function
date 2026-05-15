"use strict";

/*
=========================================================
QUERIES: LOYALTY / MEMBERSHIP
=========================================================
- Membership
- Points
- Tier
- Rewards
- Transactions
=========================================================
*/


/*
=========================================================
LẤY MEMBERSHIP USER
=========================================================
*/
const GET_USER_LOYALTY = `
  SELECT
    ul.*,

    lt.name as tier_name,

    lt.multiplier,

    lt.benefits

  FROM user_loyalty ul

  JOIN loyalty_tiers lt
    ON ul.tier_id = lt.id

  WHERE ul.user_id = $1
`;


/*
=========================================================
TẠO MEMBERSHIP
=========================================================
*/
const CREATE_USER_LOYALTY = `
  INSERT INTO user_loyalty (
    user_id,
    tier_id,
    membership_number
  )
  VALUES ($1, $2, $3)

  RETURNING *
`;


/*
=========================================================
LẤY TIER THEO NAME
=========================================================
*/
const GET_LOYALTY_TIER_BY_NAME = `
  SELECT id
  FROM loyalty_tiers
  WHERE name = $1
`;


/*
=========================================================
UPDATE POINTS
=========================================================
current_points:
  điểm redeem

lifetime_points:
  tổng điểm lifetime

tier_points:
  điểm xét tier
=========================================================
*/
const UPDATE_POINTS = `
  UPDATE user_loyalty

  SET
    current_points =
      current_points + $1,

    total_points =
      total_points + $1,

    lifetime_points =
      lifetime_points + $1,

    tier_points =
      tier_points + $1,

    updated_at = NOW()

  WHERE user_id = $2
`;


/*
=========================================================
INSERT TRANSACTION
=========================================================
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
=========================================================
LẤY LỊCH SỬ LOYALTY
=========================================================
*/
const GET_LOYALTY_HISTORY = `
  SELECT
    id,
    type,
    amount,
    description,
    created_at,
    booking_id

  FROM loyalty_transactions

  WHERE user_id = $1

  ORDER BY created_at DESC

  LIMIT 5
`;


/*
=========================================================
TÍNH NEXT TIER
=========================================================
*/
const CALCULATE_NEXT_TIER = `
  SELECT
    name,
    min_points

  FROM loyalty_tiers

  WHERE min_points > $1

  ORDER BY min_points ASC

  LIMIT 1
`;


/*
=========================================================
LẤY REWARD AVAILABLE
=========================================================
*/
const GET_AVAILABLE_REWARDS = `
  SELECT *

  FROM loyalty_rewards

  WHERE is_active = true

  ORDER BY points_required ASC
`;


/*
=========================================================
LẤY REWARD THEO ID
=========================================================
*/
const GET_REWARD_BY_ID = `
  SELECT *

  FROM loyalty_rewards

  WHERE id = $1
    AND is_active = true
`;


module.exports = {

  GET_USER_LOYALTY,

  CREATE_USER_LOYALTY,

  GET_LOYALTY_TIER_BY_NAME,

  UPDATE_POINTS,

  INSERT_TRANSACTION,

  GET_LOYALTY_HISTORY,

  CALCULATE_NEXT_TIER,

  GET_AVAILABLE_REWARDS,

  GET_REWARD_BY_ID
};