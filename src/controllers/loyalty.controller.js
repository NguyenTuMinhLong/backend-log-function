const { getMembershipInfo } = require('../services/loyalty.service');

const getMyMembership = async (req, res) => {
  try {
    // === DÙNG CHO TEST - RẤT TIỆN ===
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

module.exports = { getMyMembership };