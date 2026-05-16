const express = require('express');
const router = express.Router();

const loyaltyController = require('../controllers/loyalty.controller');
const loyaltyService = require('../services/loyalty.service');
const { authenticate, authenticateOptional } = require('../middlewares/auth.middleware');

// ============================================================
// PUBLIC / OPTIONAL AUTH
// ============================================================

// GET /api/loyalty/membership — lấy thông tin membership của user hiện tại
// Auth optional: có token → trả membership của user đó, không có → lấy từ query.userId
router.get('/membership', authenticateOptional, async (req, res) => {
  try {
    // Ưu tiên: user đã login qua token > query.userId
    const userId = req.user?.id || req.query.userId;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng đăng nhập hoặc truyền ?userId=xxx'
      });
    }

    const data = await loyaltyService.getMembershipInfo(userId);

    return res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[Loyalty] GET /membership error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
});

// GET /api/loyalty/rewards — danh sách reward có thể đổi
router.get('/rewards', async (req, res) => {
  try {
    const rewards = await loyaltyService.getAvailableRewards();
    return res.json({
      success: true,
      data: rewards
    });
  } catch (error) {
    console.error('[Loyalty] GET /rewards error:', error);
    return res.status(500).json({
      success: false,
      message: error.message
    });
  }
});

// ============================================================
// PROTECTED — CẦN AUTH
// ============================================================

// POST /api/loyalty/earn — tích điểm sau booking (idempotent)
router.post('/earn', authenticate, async (req, res) => {
  try {
    const { bookingId, totalPrice } = req.body;
    const userId = req.user.id;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu bookingId'
      });
    }

    if (totalPrice === undefined || totalPrice === null) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu totalPrice'
      });
    }

    if (typeof totalPrice !== 'number' || totalPrice < 0) {
      return res.status(400).json({
        success: false,
        message: 'totalPrice phải là số không âm'
      });
    }

    // Kiểm tra đã tích điểm chưa (idempotent)
    const existingTx = await loyaltyService.checkAlreadyEarned(userId, bookingId);

    if (existingTx) {
      return res.json({
        success: true,
        data: {
          alreadyEarned: true,
          pointsEarned: 0,
          message: 'Điểm đã được tích từ booking này'
        }
      });
    }

    const result = await loyaltyService.earnPointsAfterBooking(
      userId,
      bookingId,
      totalPrice
    );

    return res.json({
      success: true,
      data: {
        alreadyEarned: false,
        pointsEarned: result.pointsEarned
      }
    });
  } catch (error) {
    console.error('[Loyalty] POST /earn error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server khi tích điểm'
    });
  }
});

// POST /api/loyalty/revoke — revoke điểm khi huỷ booking
router.post('/revoke', authenticate, async (req, res) => {
  try {
    const { bookingId } = req.body;
    const userId = req.user.id;

    if (!bookingId) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu bookingId'
      });
    }

    const result = await loyaltyService.revokePointsOnCancel(userId, bookingId);

    return res.json({
      success: true,
      data: {
        pointsRevoked: result.pointsRevoked
      }
    });
  } catch (error) {
    console.error('[Loyalty] POST /revoke error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server khi revoke điểm'
    });
  }
});

// POST /api/loyalty/redeem — đổi điểm lấy reward
router.post('/redeem', authenticate, async (req, res) => {
  try {
    const { rewardId } = req.body;
    const userId = req.user.id;

    if (!rewardId) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu rewardId'
      });
    }

    const result = await loyaltyService.redeemReward(userId, parseInt(rewardId));

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[Loyalty] POST /redeem error:', error);

    // Phân biệt lỗi không đủ điểm vs lỗi khác
    if (error.message.includes('Không đủ điểm') || error.message.includes('tìm thấy')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server khi đổi reward'
    });
  }
});

// GET /api/loyalty/history — lịch sử giao dịch điểm
router.get('/history', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const page = Math.max(0, parseInt(req.query.page) || 0);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = page * limit;

    const history = await loyaltyService.getTransactionHistory(userId, limit, offset);
    const totalResult = await loyaltyService.getTransactionCount(userId);
    const total = parseInt(totalResult);

    return res.json({
      success: true,
      data: history,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('[Loyalty] GET /history error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server khi lấy lịch sử'
    });
  }
});

// ============================================================
// ADMIN — TRIGGER ANNUAL RESET
// ============================================================
router.post('/admin/trigger-annual-reset', authenticate, async (req, res) => {
  try {
    // Chỉ admin mới được phép trigger
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Chỉ admin mới được thực hiện thao tác này'
      });
    }

    const result = await loyaltyService.triggerAnnualReset();

    return res.json({
      success: true,
      data: result
    });
  } catch (error) {
    console.error('[Loyalty] POST /admin/trigger-annual-reset error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
});

// ============================================================
// TEST ENDPOINTS — TẠO BOOKING GIẢ ĐỂ TEST
// ============================================================
router.get('/test-earn', async (req, res) => {
  try {
    const { userId, totalPrice } = req.query;

    if (!userId || !totalPrice) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu userId hoặc totalPrice. VD: /test-earn?userId=8&totalPrice=1200000'
      });
    }

    const userIdNum = parseInt(userId);
    const priceNum = parseFloat(totalPrice);

    if (isNaN(userIdNum) || isNaN(priceNum)) {
      return res.status(400).json({
        success: false,
        message: 'userId và totalPrice phải là số'
      });
    }

    // Tạo booking giả
    const bookingId = await loyaltyService.createFakeBooking(userIdNum, priceNum);

    // Tích điểm
    const result = await loyaltyService.earnPointsAfterBooking(userIdNum, bookingId, priceNum);

    return res.json({
      success: true,
      data: {
        fakeBookingId: bookingId,
        pointsEarned: result.pointsEarned,
        message: `Tạo booking giả ${bookingId} → Tích ${result.pointsEarned} điểm`
      }
    });
  } catch (error) {
    console.error('[Loyalty] POST /test-earn error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
});

router.get('/test-redeem', async (req, res) => {
  try {
    const { userId, rewardId } = req.query;

    if (!userId || !rewardId) {
      return res.status(400).json({
        success: false,
        message: 'Thiếu userId hoặc rewardId. VD: /test-redeem?userId=8&rewardId=1'
      });
    }

    const result = await loyaltyService.redeemReward(parseInt(userId), parseInt(rewardId));

    return res.json({
      success: true,
      data: {
        rewardName: result.rewardName,
        pointsRedeemed: result.pointsRedeemed,
        remainingPoints: result.remainingPoints
      }
    });
  } catch (error) {
    console.error('[Loyalty] POST /test-redeem error:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
});

module.exports = router;