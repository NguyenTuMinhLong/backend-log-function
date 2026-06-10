'use strict';

const loyaltyService = require('../../services/loyalty.service');
const { runAnnualReset } = require('../../scripts/Loyalty.cron');
const adminFlightService = require('../../services/admin/flight.service');

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

      case 'hide_old_flights': {
        const hideResult = await adminFlightService.hideOldFlights(req.body.days ?? 1);
        return res.json({
          message: `Đã ẩn ${hideResult.hidden_count} chuyến bay cũ hơn ${hideResult.days_threshold} ngày (chưa có booking)`,
          data: hideResult,
        });
      }

      case 'all': {
        // KHÔNG chạy annual reset ở đây — annual reset chỉ chạy tự động 1/1
        // hoặc admin chủ động chọn type='loyalty_annual_reset'
        const r2 = await loyaltyService.recalculateAllTiers();
        const { rows: expiredRows } = await require('../../config/db').query(`
          UPDATE bookings SET status='expired', updated_at=NOW()
          WHERE status='pending' AND held_until IS NOT NULL AND held_until < NOW()
          RETURNING id
        `);
        const hideResult2 = await adminFlightService.hideOldFlights(req.body.days ?? 1);
        return res.json({
          message: `Đã chạy: sync tier (${r2.updated} users) + expire bookings (${expiredRows.length} bookings) + ẩn ${hideResult2.hidden_count} chuyến bay cũ`,
          data: { tiers_recalculated: r2, expired_bookings: expiredRows.length, hidden_flights: hideResult2 },
        });
      }

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

/**
 * POST /api/admin/cron/hide-old-flights
 * Ẩn (is_active = false) các chuyến bay đã bay quá `days` ngày và
 * chưa từng có booking nào tham chiếu, để giảm dữ liệu các query
 * tìm kiếm/listing chuyến bay phải quét qua.
 * Body/query: { days?: number = 1 }
 */
const hideOldFlights = async (req, res) => {
  try {
    const days = req.body?.days ?? req.query?.days ?? 1;
    const result = await adminFlightService.hideOldFlights(days);
    res.json({
      message: `Đã ẩn ${result.hidden_count} chuyến bay cũ hơn ${result.days_threshold} ngày (chưa có booking)`,
      data: result,
    });
  } catch (err) {
    console.error('[Admin Hide Old Flights]', err);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { runCron, recalculateLoyalty, runExpiredBookings, hideOldFlights };
