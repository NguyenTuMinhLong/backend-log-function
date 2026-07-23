const loyaltyService = require('../services/loyalty.service');

/*
=========================================================
CONTROLLER: LOYALTY / MEMBERSHIP
=========================================================

Logic chính đã chuyển vào routes/loyalty.routes.js:
  - Auth middleware (authenticate / authenticateOptional)
  - Request validation
  - Response formatting { success, data }

Controller giữ lại các hàm legacy để backward compatibility
với code cũ hoặc nếu cần gọi trực tiếp không qua route.

=========================================================
*/

// Lấy thông tin membership (legacy - có thể bỏ sau khi migrate hết sang route)
const getMyMembership = async (userId) => {
  return await loyaltyService.getMembershipInfo(userId);
};

// Lấy rewards có thể đổi
const getRewards = async () => {
  return await loyaltyService.getAvailableRewards();
};

module.exports = {
  getMyMembership,
  getRewards
};
