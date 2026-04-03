const couponService = require("../services/coupon.service");

const getCoupons = async (req, res) => {
  try {
    const data = await couponService.getPublicCoupons(req.query, false);
    res.json({
      message: "Lấy danh sách coupon thành công",
      data,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getAvailableCoupons = async (req, res) => {
  try {
    const data = await couponService.getPublicCoupons(req.query, true);
    res.json({
      message: "Lấy danh sách coupon khả dụng thành công",
      data,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  getCoupons,
  getAvailableCoupons,
};
