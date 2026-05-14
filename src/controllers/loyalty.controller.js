const { getMembershipInfo } = require('../services/loyalty.service');
const loyaltyService = require('../services/loyalty.service');

// ====================== MEMBERSHIP ======================
const getMyMembership = async (req, res) => {
  try {
    const userId = req.query.userId || req.user?.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng truyền ?userId=xxx hoặc đăng nhập JWT'
      });
    }

    console.log(`[Membership Controller] Lấy info cho userId = ${userId}`);

    const data = await getMembershipInfo(userId);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[Membership Controller Error]', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server khi lấy membership'
    });
  }
};

// ====================== REDEEM VOUCHER ======================
// Lấy danh sách voucher có thể đổi
const getAvailableRewards = async (req, res) => {
  try {
    const rewards = await loyaltyService.getAvailableRewards();
    res.json({ success: true, rewards });
  } catch (error) {
    console.error('[Loyalty Controller] Error getAvailableRewards:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

// Đổi điểm lấy voucher
const redeemReward = async (req, res) => {
  try {
    const { rewardId } = req.body;
    const userId = req.user?.id || req.query.userId;

    if (!rewardId) {
      return res.status(400).json({ success: false, message: 'Thiếu rewardId' });
    }
    if (!userId) {
      return res.status(400).json({ success: false, message: 'Thiếu userId' });
    }

    const result = await loyaltyService.redeemReward(parseInt(userId), parseInt(rewardId));
    res.json(result);
  } catch (error) {
    console.error('[Loyalty Controller] Error redeemReward:', error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Export tất cả
module.exports = {
  getMyMembership,
  getAvailableRewards,
  redeemReward
};