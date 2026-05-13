const { getMembershipInfo } = require('../services/loyalty.service');

const getMyMembership = async (req, res) => {
  try {
    // === DÙNG CHO TEST - DỄ DÀNG ===
    const userId = req.query.userId || req.user?.id;

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng truyền userId=? hoặc đăng nhập'
      });
    }

    console.log(`[Membership] Lấy thông tin cho userId = ${userId}`);

    const data = await getMembershipInfo(userId);

    res.json({
      success: true,
      data
    });
  } catch (error) {
    console.error('[Membership Controller Error]', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Lỗi server'
    });
  }
};

module.exports = { getMyMembership };