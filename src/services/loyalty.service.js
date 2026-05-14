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
 * TÍCH ĐIỂM sau khi booking thành công
 */
exports.earnPointsAfterBooking = async (userId, bookingId, totalPrice) => {
  const membership = await exports.getMembershipInfo(userId);

  const basePoints = Math.floor(totalPrice / 10000);           // 10.000 VNĐ = 1 điểm
  const pointsEarned = Math.floor(basePoints * membership.multiplier);

  await db.query(queries.UPDATE_POINTS, [userId, pointsEarned]);

  await db.query(queries.INSERT_TRANSACTION, [
    userId,
    bookingId,
    'earn',
    pointsEarned,
    `Tích điểm từ booking #${bookingId} (${totalPrice} VNĐ)`
  ]);

  console.log(`[Loyalty] User ${userId} tích ${pointsEarned} điểm từ booking ${bookingId}`);
  return { pointsEarned };
};