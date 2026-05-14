const db = require('../config/db');
const queries = require('../queries/loyalty.queries');

/**
 * SERVICE - Logic Membership / Loyalty (khớp schema mới)
 */

exports.getMembershipInfo = async (userId) => {
  let result = await db.query(queries.GET_USER_LOYALTY, [userId]);

  // Tự động tạo membership nếu user chưa có
  if (result.rows.length === 0) {
    console.log(`[Loyalty] User ${userId} chưa có membership → tạo mới`);

    const tierResult = await db.query(queries.GET_LOYALTY_TIER_BY_NAME, ['Member']);
    const tierId = tierResult.rows[0].id;
    const membershipNumber = `VVD${Date.now().toString().slice(-9)}`;

    await db.query(queries.CREATE_USER_LOYALTY, [userId, tierId, membershipNumber]);

    result = await db.query(queries.GET_USER_LOYALTY, [userId]);
  }

  const data = result.rows[0];

  // Tính next tier
  const nextTierResult = await db.query(queries.CALCULATE_NEXT_TIER, [data.total_points]);
  const nextTier = nextTierResult.rows[0] || { name: 'Platinum', min_points: data.total_points + 100000 };

  const progress = Math.min(
    Math.floor((data.total_points / nextTier.min_points) * 100),
    100
  );

  return {
    membership_number: data.membership_number,
    tier: data.tier_name,
    current_points: data.current_points,
    total_points: data.total_points,
    multiplier: parseFloat(data.multiplier),
    next_tier: {
      name: nextTier.name,
      points_needed: nextTier.min_points - data.total_points
    },
    benefits: data.benefits || [],
    progress: progress > 0 ? progress : 0
  };
};

/**
 * TÍCH ĐIỂM + TỰ ĐỘNG NÂNG TIER (đã fix)
 */
exports.earnPointsAfterBooking = async (userId, bookingId, totalPrice) => {
  let membership = await exports.getMembershipInfo(userId);

  const basePoints = Math.floor(totalPrice / 10000);
  const pointsEarned = Math.floor(basePoints * membership.multiplier);

  // 1. Cập nhật điểm
  await db.query(queries.UPDATE_POINTS, [userId, pointsEarned]);

  // 2. Ghi lịch sử
  await db.query(queries.INSERT_TRANSACTION, [
    userId,
    bookingId,
    'earn',
    pointsEarned,
    `Tích điểm từ booking #${bookingId} (${totalPrice} VNĐ)`
  ]);

  // 3. KIỂM TRA VÀ NÂNG TIER TỰ ĐỘNG
  await upgradeTierIfEligible(userId);

  console.log(`[Loyalty] User ${userId} tích ${pointsEarned} điểm từ booking ${bookingId}`);

  return { pointsEarned };
};

/** Hàm mới: Tự động nâng tier nếu đủ điều kiện */
const upgradeTierIfEligible = async (userId) => {
  const result = await db.query(`
    SELECT ul.total_points, lt.name as current_tier, lt.min_points
    FROM user_loyalty ul
    JOIN loyalty_tiers lt ON ul.tier_id = lt.id
    WHERE ul.user_id = $1
  `, [userId]);

  if (result.rows.length === 0) return;

  const { total_points, current_tier } = result.rows[0];

  // Tìm tier cao hơn phù hợp
  const nextTierResult = await db.query(`
    SELECT id, name 
    FROM loyalty_tiers 
    WHERE min_points <= $1 
      AND name != $2
    ORDER BY min_points DESC 
    LIMIT 1
  `, [total_points, current_tier]);

  if (nextTierResult.rows.length === 0) return;

  const newTier = nextTierResult.rows[0];

  // Nếu tier mới khác tier hiện tại → nâng cấp
  if (newTier.name !== current_tier) {
    await db.query(`
      UPDATE user_loyalty 
      SET tier_id = $1, updated_at = NOW()
      WHERE user_id = $2
    `, [newTier.id, userId]);

    console.log(`[Loyalty] 🎉 User ${userId} đã được nâng tier: ${current_tier} → ${newTier.name}`);
  }
};