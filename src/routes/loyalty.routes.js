const express = require('express');
const router = express.Router();

const { getMyMembership } = require('../controllers/loyalty.controller');
const loyaltyService = require('../services/loyalty.service');

// Route chính: xem membership
router.get('/me', getMyMembership);

// ====================== ROUTE TEST TÍCH ĐIỂM (đã fix) ======================
router.get('/test-earn', async (req, res) => {
  try {
    const userId = req.query.userId;
    const totalPrice = parseInt(req.query.totalPrice) || 500000;

    if (!userId) {
      return res.status(400).json({ 
        success: false, 
        message: 'Cần truyền ?userId=xxx' 
      });
    }

    console.log(`[TEST] Bắt đầu test tích điểm cho userId = ${userId}, giá = ${totalPrice}`);

    // bookingId = null vì đây chỉ là test
    const result = await loyaltyService.earnPointsAfterBooking(userId, null, totalPrice);

    res.json({
      success: true,
      message: 'Test tích điểm thành công!',
      pointsEarned: result.pointsEarned
    });
  } catch (err) {
    console.error('[TEST Loyalty Error]', err);
    res.status(500).json({ 
      success: false, 
      message: err.message 
    });
  }
});
// ============================================================================

module.exports = router;