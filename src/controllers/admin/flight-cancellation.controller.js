'use strict';

/*
=========================================================
AIRLINE CANCELLATION CONTROLLER
=========================================================

Admin cancel flight + auto create refunds for affected bookings
=========================================================
*/

const pool = require('../../config/db');
const QB = require('../../queries/booking.queries');
const QF = require('../../queries/flight.queries');
const QR = require('../../queries/refund.queries');
const refundService = require('../../services/refund.service');
const { createFlightCancellationNotification } = require('../../services/notification.service');

/**
 * POST /api/admin/flights/:flightId/cancel-with-refunds
 * Admin: Hủy chuyến bay + auto tạo refund cho các booking liên quan
 */
const cancelFlightWithRefunds = async (req, res) => {
  const adminId = req.user ? req.user.id : null;
  const { flightId } = req.params;
  const { reason, create_full_refund = true } = req.body;

  if (!adminId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!reason) {
    return res.status(400).json({ error: 'Vui lòng nhập lý do hủy chuyến bay' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Get flight info
    const flightResult = await client.query(QF.FIND_FLIGHT_BY_ID, [flightId]);
    if (flightResult.rows.length === 0) {
      throw new Error('Không tìm thấy chuyến bay');
    }

    const flight = flightResult.rows[0];

    // 2. Check flight status
    if (flight.status === 'cancelled') {
      throw new Error('Chuyến bay đã bị hủy trước đó');
    }

    // 3. Update flight status to cancelled
    await client.query(QF.UPDATE_FLIGHT_STATUS, ['cancelled', flightId]);

    // 4. Get all confirmed bookings for this flight
    const bookingsResult = await client.query(`
      SELECT
        b.id,
        b.booking_code,
        b.user_id,
        b.contact_email,
        b.contact_name,
        b.total_price
      FROM bookings b
      WHERE b.outbound_flight_id = $1
        AND b.status = 'confirmed'
    `, [flightId]);

    const bookings = bookingsResult.rows;
    const refundResults = [];
    const failedRefunds = [];

    // 5. For each confirmed booking, create refund request
    for (const booking of bookings) {
      try {
        // Check if booking already has payment
        const paymentResult = await client.query(`
          SELECT id, amount, final_amount, discount_amount, status
          FROM payments
          WHERE booking_id = $1 AND status = 'SUCCESS'
          ORDER BY created_at DESC
          LIMIT 1
        `, [booking.id]);

        if (paymentResult.rows.length > 0) {
          const payment = paymentResult.rows[0];

          // Calculate full refund amount
          const baseAmount = parseFloat(payment.final_amount || payment.amount);
          const refundAmount = baseAmount; // 100% refund for airline cancellation

          // Generate refund code
          const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let suffix = '';
          for (let i = 0; i < 6; i++) {
            suffix += chars[Math.floor(Math.random() * chars.length)];
          }
          const refundCode = `REF-${date}-${suffix}`;

          // Create refund request
          const refundResult = await client.query(QR.INSERT_REFUND, [
            refundCode,
            booking.id,
            payment.id,
            'full',
            null, // requested_items
            refundAmount,
            0, // admin_fee
            refundAmount, // net_refund_amount
            JSON.stringify({ name: 'airline_cancellation', label: 'Hoàn 100% - Hủy bởi hãng bay' }),
            'pending',
            `Chuyến bay ${flight.flight_number} bị hủy bởi hãng bay. Lý do: ${reason}`,
            'Auto-generated from flight cancellation',
            adminId,
          ]);

          // Update booking status to refund_pending
          await client.query(QB.UPDATE_BOOKING_STATUS, ['refund_pending', booking.id]);

          refundResults.push({
            booking_code: booking.booking_code,
            refund_code: refundCode,
            refund_amount: refundAmount,
            status: 'created',
          });
        } else {
          // Booking chưa thanh toán - chỉ cần hủy booking
          await client.query(QB.UPDATE_BOOKING_STATUS, ['cancelled', booking.id]);
          refundResults.push({
            booking_code: booking.booking_code,
            status: 'cancelled_no_refund',
            reason: 'Booking chưa thanh toán',
          });
        }
      } catch (err) {
        console.error(`[Airline Cancel] Error processing booking ${booking.booking_code}:`, err.message);
        failedRefunds.push({
          booking_code: booking.booking_code,
          error: err.message,
        });
      }
    }

    await client.query('COMMIT');

    // 6. Send notifications (async, non-blocking)
    setImmediate(async () => {
      try {
        await createFlightCancellationNotification({
          flight: {
            flight_number: flight.flight_number,
            departure_time: flight.departure_time,
          },
          bookings,
          refunds: refundResults.filter(r => r.refund_code),
        });
      } catch (notifErr) {
        console.error('[Airline Cancel] Notification error:', notifErr.message);
      }
    });

    res.json({
      message: `Đã hủy chuyến bay ${flight.flight_number}`,
      data: {
        flight_id: parseInt(flightId),
        flight_number: flight.flight_number,
        reason,
        total_bookings_affected: bookings.length,
        refunds_created: refundResults.length,
        failed_refunds: failedRefunds.length,
        details: {
          refunds: refundResults,
          failed: failedRefunds,
        },
      },
    });
  } catch (err) {
    await client.query('ROLLBACK');
    const statusCode = err.message.includes('không tìm thấy') ? 404 : 400;
    res.status(statusCode).json({ error: err.message });
  } finally {
    client.release();
  }
};

/**
 * GET /api/admin/flights/:flightId/affected-bookings
 * Admin: Xem danh sách bookings bị ảnh hưởng bởi chuyến bay
 */
const getAffectedBookings = async (req, res) => {
  try {
    const { flightId } = req.params;
    const { status } = req.query;

    let query = `
      SELECT
        b.id,
        b.booking_code,
        b.status AS booking_status,
        b.contact_name,
        b.contact_email,
        b.total_price,
        b.total_adults,
        b.total_children,
        b.total_infants,
        b.created_at
      FROM bookings b
      WHERE b.outbound_flight_id = $1
    `;

    const values = [flightId];

    if (status) {
      query += ` AND b.status = $2`;
      values.push(status);
    }

    query += ` ORDER BY b.created_at DESC`;

    const result = await pool.query(query, values);

    res.json({
      message: 'Lấy danh sách bookings bị ảnh hưởng thành công',
      data: result.rows,
      total: result.rows.length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// =========================================================
// EXPORTS
// =========================================================

module.exports = {
  cancelFlightWithRefunds,
  getAffectedBookings,
};
