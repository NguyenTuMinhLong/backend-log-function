const db = require('../config/db');
const crypto = require('crypto');
const queries = require('../queries/loyalty.queries');

/*
============================================================
LOYALTY SERVICE - Hệ thống tích điểm & Membership
============================================================

Hệ thống điểm 3 cột:
- lifetime_points: Chỉ cộng, không bao giờ giảm (lịch sử)
- tier_points: Cộng khi earn, trừ khi cancel/refund (dùng xét tier)
- current_points: Cộng khi earn, trừ khi redeem/cancel/refund (để tiêu)

Tiers: Bronze → Silver → Gold → Platinum

Action             lifetime    tier      current
──────────────────────────────────────────────
Earn (booking)     + pts       + pts     + pts
Redeem reward      —           —         - pts
Cancel / refund     —           - pts     - pts  → check downgrade
Cron annual reset  —           - 20%     —      → check downgrade
============================================================
*/


// Tier config - sửa mốc điểm tại đây
// Đồng bộ với loyalty.cron.js
const TIERS = [
  { name: 'Bronze',   min_points: 0,     multiplier: 1.0  },
  { name: 'Silver',   min_points: 5000,  multiplier: 1.25 },
  { name: 'Gold',     min_points: 20000, multiplier: 1.5  },
  { name: 'Platinum', min_points: 50000, multiplier: 1.75 },
];

// Xác định tier phù hợp theo tier_points
const resolveTier = (tierPoints) => {
  let resolved = TIERS[0];
  for (const t of TIERS) {
    if (tierPoints >= t.min_points) resolved = t;
  }
  return resolved;
};

// Tính next tier + progress bar (0-99, 100 = max tier)
const calcNextTierAndProgress = (currentTierName, tierPoints) => {
  const idx = TIERS.findIndex(t => t.name === currentTierName);
  const isMax = idx === TIERS.length - 1;

  if (isMax) return { next_tier: null, progress: 100 };

  const current = TIERS[idx];
  const next = TIERS[idx + 1];
  const progress = Math.max(0, Math.min(99,
    Math.floor(
      (tierPoints - current.min_points) /
      (next.min_points - current.min_points) * 100
    )
  ));

  return {
    next_tier: {
      name: next.name,
      points_needed: Math.max(0, next.min_points - tierPoints),
    },
    progress,
  };
};


// Benefits theo tier (song ngữ)
const TIER_BENEFITS = {
  Member: {
    vi: ["Tích điểm không giới hạn", "Ưu đãi 5% cho chuyến bay tiếp theo", "Truy cập ưu tiên vào khuyến mãi"],
    en: ["Unlimited point earning", "5% discount on your next flight", "Priority access to promotions"],
  },
  Silver: {
    vi: ["Nhân 1.25x điểm tích lũy", "Ưu đãi 10% cho chuyến bay", "Hỗ trợ khách hàng ưu tiên", "Hoàn vé ưu đãi hơn"],
    en: ["1.25x point multiplier", "10% flight discount", "Priority customer support", "Better refund terms"],
  },
  Gold: {
    vi: ["Nhân 1.5x điểm tích lũy", "Ưu đãi 15% cho chuyến bay", "Hành lý miễn phí thêm 10kg", "Đổi vé miễn phí 1 lần/năm"],
    en: ["1.5x point multiplier", "15% flight discount", "Free extra 10kg baggage", "1 free ticket change/year"],
  },
  Platinum: {
    vi: ["Nhân 1.75x điểm tích lũy", "Ưu đãi 20% cho chuyến bay", "Hành lý miễn phí thêm 20kg", "Hỗ trợ VIP 24/7", "Đổi vé không giới hạn"],
    en: ["1.75x point multiplier", "20% flight discount", "Free extra 20kg baggage", "VIP 24/7 support", "Unlimited ticket changes"],
  },
};

// ─── Lấy thông tin membership ────────────────
exports.getMembershipInfo = async (userId, lang = 'vi') => {

  let result = await db.query(queries.GET_USER_LOYALTY, [userId]);

  // Chưa có membership → tạo mới với tier Member
  if (result.rows.length === 0) {
    console.log(`[Loyalty] User ${userId} chưa có membership → tạo mới`);

    const tierResult = await db.query(
      queries.GET_LOYALTY_TIER_BY_NAME, ['Bronze']
    );

    const tierId = tierResult.rows[0].id;
    const membershipNumber = `VVD${Date.now().toString().slice(-9)}`;

    await db.query(queries.CREATE_USER_LOYALTY, [
      userId, tierId, membershipNumber,
    ]);

    result = await db.query(queries.GET_USER_LOYALTY, [userId]);
  }

  const data       = result.rows[0];
  const tierPoints = parseInt(data.tier_points);

  // Tính tier ĐÚNG theo điểm từ DB loyalty_tiers — không tin vào stored tier_id
  const correctTierRow = await db.query(`
    SELECT id, name, min_points, multiplier
    FROM loyalty_tiers
    WHERE min_points <= $1
    ORDER BY min_points DESC
    LIMIT 1
  `, [tierPoints]);

  const correctTier = correctTierRow.rows[0];
  const correctTierName = correctTier?.name || data.tier_name;

  // Cập nhật DB nếu sai tier (background, không block response)
  if (correctTier && correctTier.id !== data.tier_id) {
    db.query(`UPDATE user_loyalty SET tier_id = $1, updated_at = NOW() WHERE user_id = $2`,
      [correctTier.id, userId]).catch(() => {});
  }

  const { next_tier, progress } = calcNextTierAndProgress(correctTierName, tierPoints);

  return {
    membership_number: data.membership_number,
    tier:              correctTierName,
    lifetime_points:   parseInt(data.lifetime_points),
    tier_points:       tierPoints,
    current_points:    parseInt(data.current_points),
    multiplier:        correctTier?.multiplier ?? parseFloat(data.multiplier),
    next_tier,
    progress,
    benefits:          (TIER_BENEFITS[correctTierName]?.[lang]) || data.benefits || [],
    badge_url_light:   data.badge_url_light || null,
    badge_url_dark:    data.badge_url_dark  || null,
  };
};


// ─── Tích điểm sau booking ──────────────────
// Flow: Lấy multiplier → Tính điểm → Cộng 3 cột → Ghi transaction → Check upgrade tier
exports.earnPointsAfterBooking = async (userId, bookingId, totalPrice) => {

  // Lấy multiplier trực tiếp — nhẹ hơn gọi getMembershipInfo
  const memberResult = await db.query(`
    SELECT lt.multiplier
    FROM user_loyalty ul
    JOIN loyalty_tiers lt ON ul.tier_id = lt.id
    WHERE ul.user_id = $1
  `, [userId]);

  // Fallback về multiplier Member nếu chưa có membership
  const multiplier = memberResult.rows.length > 0
    ? parseFloat(memberResult.rows[0].multiplier)
    : TIERS[0].multiplier;

  const basePoints = Math.floor(totalPrice / 10000);
  const pointsEarned = Math.floor(basePoints * multiplier);

  if (pointsEarned <= 0) {
    console.log(`[Loyalty] Booking #${bookingId} giá trị quá thấp → bỏ qua tích điểm`);
    return { pointsEarned: 0 };
  }

  // Cộng đủ 3 cột trong 1 query
  await db.query(`
    UPDATE user_loyalty
    SET
      lifetime_points = lifetime_points + $1,
      tier_points     = tier_points     + $1,
      current_points  = current_points  + $1,
      updated_at      = NOW()
    WHERE user_id = $2
  `, [pointsEarned, userId]);

  // Ghi transaction
  await db.query(queries.INSERT_TRANSACTION, [
    userId,
    bookingId,
    'earn',
    pointsEarned,
    `Tích điểm từ booking #${bookingId} (${totalPrice.toLocaleString('vi-VN')} VNĐ)`,
  ]);

  // Check upgrade — sau earn chỉ lên tier, không xuống
  await syncTierAfterChange(userId, 'upgrade');

  console.log(
    `[Loyalty] User ${userId} tích ${pointsEarned} điểm từ booking #${bookingId}`
  );

  return { pointsEarned };
};


// ─── Trừ điểm khi hủy booking ─────────────────
// Flow: Tìm điểm đã earn → Trừ tier_points + current_points → Ghi transaction → Check downgrade
exports.revokePointsOnCancel = async (userId, bookingId) => {

  // Lấy điểm đã earn từ booking này
  const txResult = await db.query(`
    SELECT amount
    FROM loyalty_transactions
    WHERE user_id    = $1
      AND booking_id = $2
      AND type       = 'earn'
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId, bookingId]);

  // Booking chưa tích điểm → không cần revoke
  if (txResult.rows.length === 0) {
    console.log(`[Loyalty] Booking #${bookingId} chưa có điểm earn → bỏ qua revoke`);
    return { pointsRevoked: 0 };
  }

  const pointsToRevoke = parseInt(txResult.rows[0].amount);

  // Lấy điểm hiện tại để tính safe revoke
  const memberResult = await db.query(`
    SELECT tier_points, current_points
    FROM user_loyalty
    WHERE user_id = $1
  `, [userId]);

  if (memberResult.rows.length === 0) return { pointsRevoked: 0 };

  const { tier_points, current_points } = memberResult.rows[0];

  // Không để điểm âm — trừ tối đa xuống 0
  const safeRevokeTier = Math.min(pointsToRevoke, parseInt(tier_points));
  const safeRevokeCurrent = Math.min(pointsToRevoke, parseInt(current_points));

  await db.query(`
    UPDATE user_loyalty
    SET
      tier_points    = tier_points    - $1,
      current_points = current_points - $2,
      updated_at     = NOW()
    WHERE user_id = $3
  `, [safeRevokeTier, safeRevokeCurrent, userId]);

  // Ghi transaction
  await db.query(queries.INSERT_TRANSACTION, [
    userId,
    bookingId,
    'revoke',
    -safeRevokeTier,
    `Trừ điểm do huỷ booking #${bookingId} (-${safeRevokeTier} điểm)`,
  ]);

  // Check downgrade — sau revoke chỉ xuống tier, không lên
  await syncTierAfterChange(userId, 'downgrade');

  console.log(
    `[Loyalty] User ${userId} bị trừ ${safeRevokeTier} điểm do huỷ booking #${bookingId}`
  );

  return { pointsRevoked: safeRevokeTier };
};


// ─── Trừ điểm khi refund (full/partial) ────
exports.revokePointsForRefund = async (bookingId, userId, refundType = 'full', refundPercent = 100) => {
  // Lấy điểm đã earn từ booking này
  const txResult = await db.query(`
    SELECT amount
    FROM loyalty_transactions
    WHERE user_id    = $1
      AND booking_id = $2
      AND type       = 'earn'
    ORDER BY created_at DESC
    LIMIT 1
  `, [userId, bookingId]);

  // Booking chưa tích điểm → không cần revoke
  if (txResult.rows.length === 0) {
    console.log(`[Loyalty] Booking #${bookingId} chưa có điểm earn → bỏ qua revoke`);
    return { pointsRevoked: 0 };
  }

  let pointsToRevoke = parseInt(txResult.rows[0].amount);

  // Nếu là partial refund, tính lại theo tỷ lệ
  if (refundType !== 'full' && refundPercent < 100) {
    pointsToRevoke = Math.floor(pointsToRevoke * (refundPercent / 100));
  }

  // Lấy điểm hiện tại để tính safe revoke
  const memberResult = await db.query(`
    SELECT tier_points, current_points
    FROM user_loyalty
    WHERE user_id = $1
  `, [userId]);

  if (memberResult.rows.length === 0) return { pointsRevoked: 0 };

  const { tier_points, current_points } = memberResult.rows[0];

  // Không để điểm âm — trừ tối đa xuống 0
  const safeRevokeTier = Math.min(pointsToRevoke, parseInt(tier_points));
  const safeRevokeCurrent = Math.min(pointsToRevoke, parseInt(current_points));

  await db.query(`
    UPDATE user_loyalty
    SET
      tier_points    = tier_points    - $1,
      current_points = current_points - $2,
      updated_at     = NOW()
    WHERE user_id = $3
  `, [safeRevokeTier, safeRevokeCurrent, userId]);

  // Ghi transaction
  await db.query(queries.INSERT_TRANSACTION, [
    userId,
    bookingId,
    'revoke',
    -safeRevokeTier,
    `Trừ điểm do refund booking #${bookingId} (${refundType}, ${refundPercent}% = -${safeRevokeTier} điểm)`,
  ]);

  // Check downgrade — sau revoke chỉ xuống tier, không lên
  await syncTierAfterChange(userId, 'downgrade');

  console.log(
    `[Loyalty] User ${userId} bị trừ ${safeRevokeTier} điểm do refund booking #${bookingId}`
  );

  return { pointsRevoked: safeRevokeTier };
};

// ─── Đổi điểm lấy reward ──────────────────
// Flow: Lock row → Kiểm tra reward → Kiểm tra đủ điểm → Sinh voucher → Trừ current_points → Ghi transaction
// Chỉ trừ current_points, không ảnh hưởng tier
exports.redeemReward = async (userId, rewardId) => {

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // Lock row user_loyalty — chặn 2 request redeem đồng thời
    const lockResult = await client.query(`
      SELECT current_points
      FROM user_loyalty
      WHERE user_id = $1
      FOR UPDATE
    `, [userId]);

    if (lockResult.rows.length === 0) {
      throw new Error('Không tìm thấy thông tin membership');
    }

    const currentPoints = parseInt(lockResult.rows[0].current_points);

    // Lấy reward
    const rewardResult = await client.query(
      queries.GET_REWARD_BY_ID, [rewardId]
    );

    if (rewardResult.rows.length === 0) {
      throw new Error('Voucher không tồn tại hoặc đã hết hạn');
    }

    const reward = rewardResult.rows[0];

    // Kiểm tra đủ điểm — so với locked row, không phải snapshot cũ
    if (currentPoints < reward.points_required) {
      throw new Error(
        `Không đủ điểm. Cần ${reward.points_required} điểm, hiện có ${currentPoints} điểm`
      );
    }

    // Sinh voucher code
    const voucherCode = `VOUCHER-${crypto
      .randomBytes(4)
      .toString('hex')
      .toUpperCase()}`;

    // Trừ current_points, RETURNING → lấy số chính xác sau UPDATE
    const updateResult = await client.query(`
      UPDATE user_loyalty
      SET
        current_points = current_points - $1,
        updated_at     = NOW()
      WHERE user_id = $2
      RETURNING current_points
    `, [reward.points_required, userId]);

    const pointsRemaining = parseInt(updateResult.rows[0].current_points);

    // Ghi transaction
    await client.query(queries.INSERT_TRANSACTION, [
      userId,
      null,
      'redeem',
      -reward.points_required,
      `Đổi ${reward.name} - Mã: ${voucherCode} (-${reward.points_required} điểm)`,
    ]);

    await client.query('COMMIT');

    console.log(
      `[Loyalty] User ${userId} redeem ${reward.name} - Mã: ${voucherCode}`
    );

    return {
      success: true,
      reward: {
        id: reward.id,
        name: reward.name,
        discountAmount: reward.discount_amount,
        description: reward.description,
      },
      voucherCode,
      pointsRemaining,  // từ RETURNING — luôn chính xác
      message: `Đổi thành công! Mã voucher của bạn là ${voucherCode}`,
    };

  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};


// ─── Lấy danh sách rewards ───────────────
exports.getAvailableRewards = async () => {
  const result = await db.query(queries.GET_AVAILABLE_REWARDS);
  return result.rows;
};


// ─── Kiểm tra đã tích điểm chưa ─────────
exports.checkAlreadyEarned = async (userId, bookingId) => {
  const result = await db.query(`
    SELECT id
    FROM loyalty_transactions
    WHERE user_id    = $1
      AND booking_id = $2
      AND type       = 'earn'
    LIMIT 1
  `, [userId, bookingId]);
  return result.rows.length > 0;
};


// ─── Lịch sử giao dịch ───────────────────
exports.getTransactionHistory = async (userId, limit = 20, offset = 0) => {
  const result = await db.query(queries.GET_LOYALTY_HISTORY, [
    userId,
    limit,
    offset
  ]);
  return result.rows;
};

exports.getTransactionCount = async (userId) => {
  const result = await db.query(`
    SELECT COUNT(*) as total
    FROM loyalty_transactions
    WHERE user_id = $1
  `, [userId]);
  return result.rows[0].total;
};


// ─── Trigger annual reset (admin) ──────────
exports.triggerAnnualReset = async () => {
  const { runAnnualReset } = require('../scripts/Loyalty.cron');
  await runAnnualReset();

  // Trả về summary
  return {
    message: 'Annual reset đã được kích hoạt thành công',
    timestamp: new Date().toISOString()
  };
};


// ─── Sync tier sau thay đổi điểm ──────────
// direction:
//   'upgrade'   → chỉ lên tier, không xuống  (sau earn)
//   'downgrade' → chỉ xuống tier, không lên  (sau cancel/refund/cron)
//   'both'      → sync tuyệt đối              (dùng khi cần force sync)
const syncTierAfterChange = async (userId, direction = 'both') => {

  const result = await db.query(`
    SELECT ul.tier_points, ul.tier_id, lt.min_points AS current_min
    FROM user_loyalty ul
    JOIN loyalty_tiers lt ON ul.tier_id = lt.id
    WHERE ul.user_id = $1
  `, [userId]);

  if (result.rows.length === 0) return;

  const { tier_points, tier_id: currentTierId, current_min } = result.rows[0];

  // Tìm tier đúng theo min_points trong DB — không phụ thuộc vào tên
  const tierResult = await db.query(`
    SELECT id, name, min_points
    FROM loyalty_tiers
    WHERE min_points <= $1
    ORDER BY min_points DESC
    LIMIT 1
  `, [parseInt(tier_points)]);

  if (tierResult.rows.length === 0) return;

  const correctTier = tierResult.rows[0];

  // Không cần thay đổi
  if (correctTier.id === currentTierId) return;

  const isUpgrade = correctTier.min_points > current_min;

  // Bỏ qua nếu không đúng chiều
  if (direction === 'upgrade' && !isUpgrade) return;
  if (direction === 'downgrade' && isUpgrade) return;

  await db.query(`
    UPDATE user_loyalty
    SET
      tier_id    = $1,
      updated_at = NOW()
    WHERE user_id = $2
  `, [tierResult.rows[0].id, userId]);

  // Notify khi tụt tier
  if (!isUpgrade) {
    await db.query(`
      INSERT INTO loyalty_notifications (user_id, type, message, created_at)
      VALUES ($1, 'tier_downgrade', $2, NOW())
    `, [
      userId,
      `Hạng thành viên của bạn đã thay đổi xuống ${correctTier.name}.`,
    ]);

    console.log(`[Loyalty] User ${userId} tụt tier → ${correctTier.name}`);
  } else {
    console.log(`[Loyalty] User ${userId} lên tier → ${correctTier.name}`);
  }
};

// Export để cron job gọi sau khi penalty tier_points
exports.syncTierAfterChange = syncTierAfterChange;

// ─── Recalculate all tiers ─────────────────
// Sync tier_id cho toàn bộ user dựa trên tier_points hiện tại
exports.recalculateAllTiers = async () => {
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const { rows: members } = await client.query(`
      SELECT ul.user_id, ul.tier_points, lt.name AS current_tier
      FROM user_loyalty ul
      JOIN loyalty_tiers lt ON ul.tier_id = lt.id
    `);

    let updated = 0;
    for (const m of members) {
      const correctTier = resolveTier(parseInt(m.tier_points));
      if (correctTier.name === m.current_tier) continue;

      const { rows } = await client.query(
        `SELECT id FROM loyalty_tiers WHERE name = $1`, [correctTier.name]
      );
      if (!rows.length) continue;

      await client.query(
        `UPDATE user_loyalty SET tier_id = $1, updated_at = NOW() WHERE user_id = $2`,
        [rows[0].id, m.user_id]
      );
      updated++;
      console.log(`[Loyalty] Recalc: user ${m.user_id} ${m.current_tier} → ${correctTier.name}`);
    }

    await client.query('COMMIT');
    console.log(`[Loyalty] Recalculate xong: ${updated}/${members.length} users được cập nhật tier`);
    return { total: members.length, updated };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
};

// ─── Test helpers: Tạo booking giả để test ──
exports.createFakeBooking = async (userId, totalPrice) => {
  const bookingId = Math.floor(Date.now() / 1000);
  const bookingCode = String(bookingId).slice(-8);

  // Lấy flight có sẵn
  const flightRes = await db.query(`SELECT id FROM flights LIMIT 1`);
  const flightId = flightRes.rows[0]?.id || 1;

  await db.query(`
    INSERT INTO bookings (
      id, booking_code, user_id, outbound_flight_id, outbound_seat_class,
      trip_type, total_adults, total_children, total_infants,
      base_price, total_price, status, contact_email, contact_name, created_at, updated_at
    )
    VALUES ($1, $2, $3, $4, 'economy', 'one_way', 1, 0, 0, $5, $5, 'confirmed', 'test@test.com', 'Test User', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET updated_at = NOW()
  `, [bookingId, bookingCode, userId, flightId, totalPrice]);

  console.log(`[Loyalty Test] Tạo booking giả: ${bookingId} (userId=${userId}, price=${totalPrice})`);
  return bookingId;
};