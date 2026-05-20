'use strict';

const loyaltyService = require('../../services/loyalty.service');
const { runAnnualReset } = require('../../scripts/Loyalty.cron');

/**
 * POST /api/admin/cron/run
 * Chạy thủ công một cronjob theo type
 */
const runCron = async (req, res) => {
  const { type } = req.body;
  try {
    switch (type) {
      case 'loyalty_annual_reset':
        await runAnnualReset();
        return res.json({ message: 'Annual loyalty reset đã chạy thành công' });

      case 'loyalty_recalculate':
        const result = await loyaltyService.recalculateAllTiers();
        return res.json({
          message: `Recalculate tier xong: ${result.updated}/${result.total} users được cập nhật`,
          data: result,
        });

      case 'all':
        await loyaltyService.triggerAnnualReset();
        const r2 = await loyaltyService.recalculateAllTiers();
        return res.json({
          message: 'Đã chạy tất cả cronjob',
          data: { loyalty_reset: true, tiers_recalculated: r2 },
        });

      default:
        return res.status(400).json({ error: `Không tìm thấy cronjob type: "${type}"` });
    }
  } catch (err) {
    console.error('[Admin Cron]', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/admin/loyalty/recalculate
 * Tính lại tier cho toàn bộ thành viên
 */
const recalculateLoyalty = async (req, res) => {
  try {
    const result = await loyaltyService.recalculateAllTiers();
    res.json({
      message: `Recalculate xong: ${result.updated}/${result.total} users được cập nhật tier`,
      data: result,
    });
  } catch (err) {
    console.error('[Admin Loyalty Recalc]', err);
    res.status(500).json({ error: err.message });
  }
};

/**
 * POST /api/admin/cron/expired-bookings
 * Xử lý booking hết hạn (expire pending bookings)
 */
const runExpiredBookings = async (req, res) => {
  try {
    const pool = require('../../config/db');
    const { rows } = await pool.query(`
      UPDATE bookings
      SET status = 'expired', updated_at = NOW()
      WHERE status = 'pending'
        AND held_until IS NOT NULL
        AND held_until < NOW()
      RETURNING id, booking_code
    `);
    res.json({
      message: `Đã expire ${rows.length} booking hết hạn`,
      data: { expired_count: rows.length, booking_codes: rows.map(r => r.booking_code) },
    });
  } catch (err) {
    console.error('[Admin Expire Bookings]', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { runCron, recalculateLoyalty, runExpiredBookings };
