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
        // KHÔNG chạy annual reset ở đây — annual reset chỉ chạy tự động 1/1
        // hoặc admin chủ động chọn type='loyalty_annual_reset'
        const r2 = await loyaltyService.recalculateAllTiers();
        const { rows: expiredRows } = await require('../../config/db').query(`
          UPDATE bookings SET status='expired', updated_at=NOW()
          WHERE status='pending' AND held_until IS NOT NULL AND held_until < NOW()
          RETURNING id
        `);
        return res.json({
          message: `Đã chạy: sync tier (${r2.updated} users) + expire bookings (${expiredRows.length} bookings)`,
          data: { tiers_recalculated: r2, expired_bookings: expiredRows.length },
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
