const cron = require('node-cron');
const db   = require('../config/db');

/*
=========================================================
LOYALTY ANNUAL RESET CRON JOB
=========================================================

Chạy: 00:00 ngày 1/1 theo GMT+7 (= 17:00 UTC ngày 31/12)

Logic:
  1. Lấy tất cả membership
  2. Phạt 20% tier_points  (tier_points -= tier_points * 0.20)
  3. Recalculate tier theo tier_points mới
  4. Nếu tier thay đổi → downgrade + notify
  5. lifetime_points KHÔNG đổi
  6. current_points  KHÔNG đổi

Cột       | Reset?  | Ghi chú
----------|---------|----------------------------
lifetime  | ❌      | Chỉ cộng, không bao giờ trừ
tier      | ✅ -20% | Xét tier + cronjob penalty
current   | ❌      | Điểm redeem, user giữ nguyên

=========================================================
*/

// Tier config — giữ đồng bộ với loyalty.service.js
const TIERS = [
  { name: 'Member',   min_points: 0      },
  { name: 'Silver',   min_points: 5000   },
  { name: 'Gold',     min_points: 20000  },
  { name: 'Platinum', min_points: 50000  },
];

// Tính tier phù hợp nhất theo số điểm
const resolveTier = (tierPoints) => {
  let resolved = TIERS[0];
  for (const tier of TIERS) {
    if (tierPoints >= tier.min_points) resolved = tier;
  }
  return resolved;
};

// =========================================================
// MAIN RESET FUNCTION
// =========================================================
const runAnnualReset = async () => {

  console.log('[Loyalty Cron] ========== BẮT ĐẦU ANNUAL RESET ==========');
  console.log(`[Loyalty Cron] Thời gian: ${new Date().toISOString()}`);

  const client = await db.connect();

  try {
    await client.query('BEGIN');

    // ── 1. Lấy toàn bộ membership ──────────────────────────
    const { rows: members } = await client.query(`
      SELECT
        ul.user_id,
        ul.tier_points,
        lt.name  AS current_tier,
        lt.id    AS current_tier_id
      FROM user_loyalty ul
      JOIN loyalty_tiers lt ON ul.tier_id = lt.id
    `);

    console.log(`[Loyalty Cron] Tổng membership: ${members.length}`);

    let upgraded   = 0;
    let downgraded = 0;
    let unchanged  = 0;

    for (const member of members) {

      const oldTierPoints = parseInt(member.tier_points);

      // ── 2. Phạt 20% tier_points ────────────────────────
      //    floor để không có số lẻ
      const penalty      = Math.floor(oldTierPoints * 0.20);
      const newTierPoints = oldTierPoints - penalty;

      // ── 3. Tính tier mới ───────────────────────────────
      const newTier = resolveTier(newTierPoints);

      // ── 4. Update tier_points ──────────────────────────
      await client.query(`
        UPDATE user_loyalty
        SET
          tier_points = $1,
          updated_at  = NOW()
        WHERE user_id = $2
      `, [newTierPoints, member.user_id]);

      // ── 5. Tier có thay đổi không? ─────────────────────
      if (newTier.name !== member.current_tier) {

        // Lấy id tier mới
        const { rows: tierRows } = await client.query(`
          SELECT id FROM loyalty_tiers WHERE name = $1
        `, [newTier.name]);

        if (tierRows.length > 0) {
          await client.query(`
            UPDATE user_loyalty
            SET
              tier_id    = $1,
              updated_at = NOW()
            WHERE user_id = $2
          `, [tierRows[0].id, member.user_id]);
        }

        // ── 6. Ghi notification ─────────────────────────
        await client.query(`
          INSERT INTO loyalty_notifications
            (user_id, type, message, created_at)
          VALUES
            ($1, $2, $3, NOW())
        `, [
          member.user_id,
          'tier_reset',
          buildNotificationMessage({
            oldTier:      member.current_tier,
            newTier:      newTier.name,
            oldPoints:    oldTierPoints,
            newPoints:    newTierPoints,
            penalty,
          }),
        ]);

        const direction = TIERS.findIndex(t => t.name === newTier.name)
          > TIERS.findIndex(t => t.name === member.current_tier)
          ? '↑' : '↓';

        console.log(
          `[Loyalty Cron] User ${member.user_id}: ${member.current_tier} ${direction} ${newTier.name}` +
          ` | tier_points: ${oldTierPoints} → ${newTierPoints} (-${penalty})`
        );

        direction === '↓' ? downgraded++ : upgraded++;

      } else {

        // Tier không đổi — vẫn ghi thông báo penalty cho user biết
        await client.query(`
          INSERT INTO loyalty_notifications
            (user_id, type, message, created_at)
          VALUES
            ($1, 'points_reset', $2, NOW())
        `, [
          member.user_id,
          `Điểm hạng của bạn đã được điều chỉnh hàng năm: ${oldTierPoints.toLocaleString('vi-VN')} → ${newTierPoints.toLocaleString('vi-VN')} điểm (-20%). Hạng ${member.current_tier} được giữ nguyên.`,
        ]);

        unchanged++;
      }
    }

    await client.query('COMMIT');

    console.log(`[Loyalty Cron] ✅ Hoàn tất:`);
    console.log(`[Loyalty Cron]    Giữ tier  : ${unchanged}`);
    console.log(`[Loyalty Cron]    Tụt tier  : ${downgraded}`);
    console.log(`[Loyalty Cron]    Lên tier  : ${upgraded}`);  // edge case: penalty đẩy về tier thấp hơn rồi resolveTier cho tier cao hơn — thực tế không xảy ra nhưng log cho chắc
    console.log('[Loyalty Cron] ========== KẾT THÚC ANNUAL RESET ==========');

  } catch (err) {

    await client.query('ROLLBACK');
    console.error('[Loyalty Cron] ❌ Lỗi — đã rollback toàn bộ:', err);
    throw err;

  } finally {
    client.release();
  }
};

// =========================================================
// NOTIFICATION MESSAGE BUILDER
// =========================================================
const buildNotificationMessage = ({
  oldTier,
  newTier,
  oldPoints,
  newPoints,
  penalty,
}) => {
  const tierOrder  = TIERS.map(t => t.name);
  const isDowngrade = tierOrder.indexOf(newTier) < tierOrder.indexOf(oldTier);

  if (isDowngrade) {
    return (
      `Hạng thành viên của bạn đã được điều chỉnh sau kỳ đánh giá hàng năm. ` +
      `Điểm hạng: ${oldPoints.toLocaleString('vi-VN')} → ${newPoints.toLocaleString('vi-VN')} (-${penalty.toLocaleString('vi-VN')} điểm). ` +
      `Hạng hiện tại: ${oldTier} → ${newTier}. ` +
      `Hãy tích lũy thêm điểm để khôi phục hạng ${oldTier}!`
    );
  }

  // Trường hợp lên tier sau penalty (hiếm — chỉ xảy ra nếu logic tier thay đổi)
  return (
    `Chúc mừng! Hạng thành viên của bạn đã được nâng lên ${newTier} ` +
    `sau kỳ đánh giá hàng năm.`
  );
};

// =========================================================
// SCHEDULE
// =========================================================
//
// 00:00 GMT+7 = 17:00 UTC ngày hôm trước
// Cron format: giây(opt) phút giờ ngày tháng thứ
//
//   "0 17 31 12 *"  →  17:00 UTC ngày 31/12
//
// node-cron không support timezone natively ở bản cũ,
// dùng option { timezone: "Asia/Ho_Chi_Minh" } nếu version >= 3
//
cron.schedule(
  '0 0 1 1 *',           // 00:00 ngày 1/1
  runAnnualReset,
  {
    timezone: 'Asia/Ho_Chi_Minh',
    scheduled: true,
  }
);

console.log('[Loyalty Cron] Đã đăng ký annual reset — chạy lúc 00:00 ngày 1/1 (GMT+7)');

// =========================================================
// EXPORT (để test thủ công hoặc chạy từ script khác)
// =========================================================
module.exports = { runAnnualReset };