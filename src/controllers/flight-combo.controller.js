/**
 * Flight Combo Controller - API tim kiem ve multi-leg cross-airline
 * 
 * GET /api/flights/mixed-search
 */

const flightComboService = require('../services/flight-combo.service');

// ============== API ==============

/**
 * Tim kiem ve - ket hop nhieu chuyen bay nhieu hang
 * 
 * Query params:
 * - from: Ma san bay di (VD: HAN)
 * - to: Ma san bay den (VD: SGN)
 * - outbound_date: Ngay di (YYYY-MM-DD)
 * - return_date: Ngay ve (YYYY-MM-DD) - optional
 * - adults: So nguoi lon (default: 1)
 * - children: So tre em (default: 0)
 * - infants: So em be (default: 0)
 * - seat_class: economy | business | first (default: economy)
 * - max_stops: So stop toi da 0|1|2 (default: 2)
 * - limit: So ket qua toi da (default: 20)
 * - sort_by: recommended | price | duration (default: recommended)
 */
const mixedSearch = async (req, res) => {
  try {
    const {
      from,
      to,
      outbound_date,
      return_date,
      adults,
      children,
      infants,
      seat_class,
      max_stops,
      limit,
      sort_by,
    } = req.query;

    // Validate cac tham so bat buoc
    if (!from || !to || !outbound_date) {
      return res.status(400).json({
        error: 'Thieu tham so bat buoc: from, to, outbound_date',
      });
    }

    // Goi service
    const results = await flightComboService.mixedSearch({
      from,
      to,
      outbound_date,
      return_date,
      adults,
      children,
      infants,
      seat_class,
      max_stops,
      limit,
      sort_by,
    });

    res.json({
      message: 'Tim kiem thanh cong',
      data: results,
    });
  } catch (err) {
    console.error('[MixedSearch Error]', err);
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  mixedSearch,
};
