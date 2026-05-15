const db = require('../config/db');
const crypto = require('crypto');
const queries = require('../queries/loyalty.queries');

/*
=========================================================
SERVICE: LOYALTY / MEMBERSHIP BUSINESS LOGIC
=========================================================
- Membership info
- Earn points
- Auto upgrade tier
- Redeem reward
- Loyalty transactions
=========================================================
*/


/*
=========================================================
LẤY MEMBERSHIP INFO
=========================================================
*/
exports.getMembershipInfo = async (userId) => {

  // Query membership hiện tại
  let result = await db.query(
    queries.GET_USER_LOYALTY,
    [userId]
  );

  /*
  Nếu chưa có membership:
  - tạo membership mặc định
  - tier mặc định = Member
  */
  if (result.rows.length === 0) {

    console.log(
      `[Loyalty] User ${userId} chưa có membership → tạo mới`
    );

    // Lấy default tier
    const tierResult = await db.query(
      queries.GET_LOYALTY_TIER_BY_NAME,
      ['Member']
    );

    const tierId = tierResult.rows[0].id;

    // Sinh membership number
    const membershipNumber =
      `VVD${Date.now().toString().slice(-9)}`;

    // Tạo membership
    await db.query(
      queries.CREATE_USER_LOYALTY,
      [
        userId,
        tierId,
        membershipNumber
      ]
    );

    // Query lại membership
    result = await db.query(
      queries.GET_USER_LOYALTY,
      [userId]
    );
  }

  // Membership data
  const data = result.rows[0];

  /*
  =========================================================
  TÍNH NEXT TIER
  =========================================================
  */
  const nextTierResult = await db.query(
    queries.CALCULATE_NEXT_TIER,
    [data.tier_points]
  );

  // Nếu không còn tier cao hơn
  const nextTier =
    nextTierResult.rows[0] || {
      name: 'Platinum',
      min_points: data.tier_points + 100000
    };

  /*
  =========================================================
  TÍNH PROGRESS %
  =========================================================
  */
  const progress = Math.min(
    Math.floor(
      (
        data.tier_points /
        nextTier.min_points
      ) * 100
    ),
    100
  );

  /*
  =========================================================
  RESPONSE CHO FRONTEND
  =========================================================
  */
  return {

    // Membership number
    membership_number:
      data.membership_number,

    // Tier hiện tại
    tier:
      data.tier_name,

    // Điểm dùng redeem
    current_points:
      data.current_points,

    // Tổng điểm lifetime
    total_points:
      data.total_points,

    // Tổng điểm lifetime v2
    lifetime_points:
      data.lifetime_points,

    // Điểm dùng xét tier
    tier_points:
      data.tier_points,

    // Multiplier
    multiplier:
      parseFloat(data.multiplier),

    // Tier tiếp theo
    next_tier: {

      name:
        nextTier.name,

      points_needed:
        nextTier.min_points -
        data.tier_points
    },

    // Benefit
    benefits:
      data.benefits || [],

    // Progress %
    progress:
      progress > 0 ? progress : 0
  };
};


/*
=========================================================
TÍCH ĐIỂM SAU BOOKING
=========================================================
Flow:
1. Lấy membership
2. Tính điểm
3. Update points
4. Ghi transaction
5. Auto upgrade tier
=========================================================
*/
exports.earnPointsAfterBooking = async (
  userId,
  bookingId,
  totalPrice
) => {

  // Membership hiện tại
  const membership =
    await exports.getMembershipInfo(userId);

  /*
  =========================================================
  TÍNH ĐIỂM
  =========================================================
  1 điểm / 10.000 VNĐ
  */
  const basePoints =
    Math.floor(totalPrice / 10000);

  // Áp multiplier theo tier
  const pointsEarned =
    Math.floor(
      basePoints *
      membership.multiplier
    );

  /*
  =========================================================
  UPDATE POINTS
  =========================================================
  current_points:
    điểm redeem

  lifetime_points:
    tổng điểm không reset

  tier_points:
    điểm xét tier
  */
  await db.query(
    queries.UPDATE_POINTS,
    [
      pointsEarned,
      userId
    ]
  );

  /*
  =========================================================
  GHI TRANSACTION
  =========================================================
  */
  await db.query(
    queries.INSERT_TRANSACTION,
    [
      userId,
      bookingId,
      'earn',
      pointsEarned,
      `Tích điểm từ booking #${bookingId} (${totalPrice} VNĐ)`
    ]
  );

  /*
  =========================================================
  AUTO UPGRADE TIER
  =========================================================
  */
  await upgradeTierIfEligible(userId);

  console.log(
    `[Loyalty] User ${userId} tích ${pointsEarned} điểm từ booking ${bookingId}`
  );

  return {
    pointsEarned
  };
};


/*
=========================================================
AUTO UPGRADE TIER
=========================================================
- tier_points dùng để xét tier
- redeem KHÔNG làm tụt tier
=========================================================
*/
const upgradeTierIfEligible = async (
  userId
) => {

  // Lấy tier hiện tại + tier points
  const result = await db.query(`
    SELECT
      ul.tier_points,
      lt.name as current_tier,
      lt.min_points
    FROM user_loyalty ul
    JOIN loyalty_tiers lt
      ON ul.tier_id = lt.id
    WHERE ul.user_id = $1
  `, [userId]);

  // Không có membership
  if (result.rows.length === 0) {
    return;
  }

  const {
    tier_points,
    current_tier
  } = result.rows[0];

  /*
  =========================================================
  TÌM TIER PHÙ HỢP NHẤT
  =========================================================
  */
  const nextTierResult =
    await db.query(`
      SELECT
        id,
        name
      FROM loyalty_tiers
      WHERE min_points <= $1
        AND name != $2
      ORDER BY min_points DESC
      LIMIT 1
    `, [
      tier_points,
      current_tier
    ]);

  // Không có tier mới
  if (nextTierResult.rows.length === 0) {
    return;
  }

  const newTier =
    nextTierResult.rows[0];

  /*
  =========================================================
  UPDATE TIER
  =========================================================
  */
  if (newTier.name !== current_tier) {

    await db.query(`
      UPDATE user_loyalty
      SET
        tier_id = $1,
        updated_at = NOW()
      WHERE user_id = $2
    `, [
      newTier.id,
      userId
    ]);

    console.log(
      `[Loyalty]  User ${userId} đã được nâng tier: ${current_tier} → ${newTier.name}`
    );
  }
};


/*
=========================================================
LẤY DANH SÁCH REWARD
=========================================================
*/
exports.getAvailableRewards = async () => {

  const result = await db.query(
    queries.GET_AVAILABLE_REWARDS
  );

  return result.rows;
};


/*
=========================================================
REDEEM REWARD
=========================================================
Flow:
1. Lấy membership
2. Kiểm tra reward
3. Kiểm tra đủ điểm
4. Sinh voucher code
5. Trừ current_points
6. Ghi transaction
=========================================================
*/
exports.redeemReward = async (
  userId,
  rewardId
) => {

  /*
  =========================================================
  MEMBERSHIP INFO
  =========================================================
  */
  const membership =
    await exports.getMembershipInfo(userId);

  if (!membership) {

    throw new Error(
      'Không tìm thấy thông tin membership'
    );
  }

  /*
  =========================================================
  LẤY REWARD
  =========================================================
  */
  const rewardResult =
    await db.query(
      queries.GET_REWARD_BY_ID,
      [rewardId]
    );

  // Reward không tồn tại
  if (rewardResult.rows.length === 0) {

    throw new Error(
      'Voucher không tồn tại hoặc đã hết hạn'
    );
  }

  const reward =
    rewardResult.rows[0];

  /*
  =========================================================
  CHECK ĐỦ ĐIỂM
  =========================================================
  current_points:
    điểm có thể tiêu
  */
  if (
    membership.current_points <
    reward.points_required
  ) {

    throw new Error(
      `Không đủ điểm. Cần ${reward.points_required} điểm, hiện có ${membership.current_points} điểm`
    );
  }

  /*
  =========================================================
  SINH MÃ VOUCHER
  =========================================================
  */
  const voucherCode =
    `VOUCHER-${crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;

  /*
  =========================================================
  TRỪ ĐIỂM
  =========================================================
  Chỉ trừ current_points
  KHÔNG trừ tier_points
  KHÔNG tụt tier
  =========================================================
  */
  await db.query(`
    UPDATE user_loyalty
    SET
      current_points =
        current_points - $1,

      updated_at = NOW()

    WHERE user_id = $2
  `, [
    reward.points_required,
    userId
  ]);

  /*
  =========================================================
  GHI TRANSACTION
  =========================================================
  */
  const transactionDesc =
    `Đổi ${reward.name} - Mã: ${voucherCode} (-${reward.points_required} điểm)`;

  await db.query(
    queries.INSERT_TRANSACTION,
    [
      userId,
      null,
      'redeem',
      -reward.points_required,
      transactionDesc
    ]
  );

  console.log(
    `[Loyalty] User ${userId} đã redeem ${reward.name} - Mã: ${voucherCode}`
  );

  /*
  =========================================================
  RESPONSE CHO FRONTEND
  =========================================================
  */
  return {

    success: true,

    reward: {

      id:
        reward.id,

      name:
        reward.name,

      discountAmount:
        reward.discount_amount,

      description:
        reward.description
    },

    // Voucher code
    voucherCode,

    // Điểm còn lại
    pointsRemaining:
      membership.current_points -
      reward.points_required,

    // Tier hiện tại
    currentTier:
      membership.tier,

    message:
      `Đổi thành công! Mã voucher của bạn là ${voucherCode}`
  };
};