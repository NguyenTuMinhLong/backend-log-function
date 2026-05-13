const pool = require('../config/db');
const queries = require('../queries/loyalty.queries');

const getMembershipInfo = async (userId) => {
    try {
        // Lấy thông tin loyalty hiện tại
        const loyaltyRes = await pool.query(queries.GET_USER_LOYALTY, [userId]);

        if (loyaltyRes.rows.length === 0) {
            // User chưa có tài khoản loyalty → tạo mới với tier Member
            const defaultTierRes = await pool.query(
                `SELECT id FROM loyalty_tiers WHERE name = 'Member'`
            );

            await pool.query(`
        INSERT INTO user_loyalty (user_id, tier_id, membership_number)
        VALUES ($1, $2, $3)
      `, [userId, defaultTierRes.rows[0].id, `VVD${Date.now().toString().slice(-9)}`]);

            return getMembershipInfo(userId); // recursive call để lấy lại data
        }

        const loyalty = loyaltyRes.rows[0];

        // Lấy lịch sử 5 giao dịch gần nhất
        const historyRes = await pool.query(queries.GET_LOYALTY_HISTORY, [userId]);

        // Tính next tier
        let nextTier = null;
        const nextTierRes = await pool.query(queries.CALCULATE_NEXT_TIER, [loyalty.total_points]);

        if (nextTierRes.rows.length > 0) {
            nextTier = {
                name: nextTierRes.rows[0].name,
                points_needed: nextTierRes.rows[0].min_points - loyalty.total_points
            };
        }

        return {
            membership_number: loyalty.membership_number,
            tier: loyalty.tier_name,
            current_points: parseInt(loyalty.current_points),
            total_points: parseInt(loyalty.total_points),
            multiplier: parseFloat(loyalty.multiplier),
            next_tier: nextTier,
            benefits: loyalty.benefits || [],
            history: historyRes.rows.map(row => ({
                id: row.id,
                type: row.type,
                amount: parseInt(row.amount),
                description: row.description,
                date: row.created_at
            })),
            progress: nextTier
                ? Math.min(100, Math.floor((loyalty.total_points / (loyalty.total_points + nextTier.points_needed)) * 100))
                : 100
        };

    } catch (error) {
        console.error('[Loyalty Service Error]', error);
        throw new Error('Không thể lấy thông tin membership');
    }
};
// ── Earn Points (CU-07) ────────────────────────────────────────
const earnPoints = async (userId, bookingId, totalPrice) => {
    try {
        // Lấy tier hiện tại để tính multiplier
        const loyaltyRes = await pool.query(
            `SELECT lt.multiplier FROM user_loyalty ul 
       JOIN loyalty_tiers lt ON ul.tier_id = lt.id 
       WHERE ul.user_id = $1`, [userId]
        );

        const multiplier = loyaltyRes.rows[0] ? parseFloat(loyaltyRes.rows[0].multiplier) : 1.0;

        const pointsEarned = Math.floor(totalPrice / 10000) * multiplier;

        if (pointsEarned <= 0) return 0;

        // Cộng điểm
        await pool.query(`
      UPDATE user_loyalty 
      SET total_points = total_points + $1,
          current_points = current_points + $1,
          updated_at = NOW()
      WHERE user_id = $2`, [pointsEarned, userId]);

        // Ghi lịch sử
        await pool.query(`
      INSERT INTO loyalty_transactions 
        (user_id, type, amount, booking_id, description)
      VALUES ($1, 'earn', $2, $3, $4)`,
            [userId, pointsEarned, bookingId, `Earn from booking #${bookingId}`]);

        console.log(`✅ Earned ${pointsEarned} points for user ${userId}`);
        return pointsEarned;
    } catch (error) {
        console.error('[Earn Points Error]', error);
        return 0;
    }
};

// ── Redeem Points (CU-08) ───────────────────────────────────────
const redeemPoints = async (userId, bookingId, pointsToRedeem, description) => {
    try {
        const result = await pool.query(`
      UPDATE user_loyalty 
      SET current_points = current_points - $1,
          updated_at = NOW()
      WHERE user_id = $2 AND current_points >= $1
      RETURNING current_points`, [pointsToRedeem, userId]);

        if (result.rows.length === 0) {
            throw new Error('Không đủ điểm để redeem');
        }

        await pool.query(`
      INSERT INTO loyalty_transactions 
        (user_id, type, amount, booking_id, description)
      VALUES ($1, 'redeem', $2, $3, $4)`,
            [userId, -pointsToRedeem, bookingId, description]);

        return true;
    } catch (error) {
        console.error('[Redeem Points Error]', error);
        throw error;
    }
};

module.exports = { getMembershipInfo, earnPoints, redeemPoints };