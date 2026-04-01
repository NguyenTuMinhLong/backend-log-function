const adminCouponService = require("../services/admin.coupon.service");

const getCoupons = async (req, res) => {
  try {
    const result = await adminCouponService.getCoupons(req.query);
    res.json({
      message: "Lấy danh sách coupon thành công",
      ...result,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const getCouponById = async (req, res) => {
  try {
    const coupon = await adminCouponService.getCouponById(req.params.id);
    res.json({
      message: "Lấy chi tiết coupon thành công",
      data: coupon,
    });
  } catch (err) {
    res.status(404).json({ error: err.message });
  }
};

const createCoupon = async (req, res) => {
  try {
    const coupon = await adminCouponService.createCoupon(req.body);
    res.status(201).json({
      message: "Tạo coupon thành công",
      data: coupon,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const updateCoupon = async (req, res) => {
  try {
    const coupon = await adminCouponService.updateCoupon(req.params.id, req.body);
    res.json({
      message: "Cập nhật coupon thành công",
      data: coupon,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const updateCouponStatus = async (req, res) => {
  try {
    const { is_active } = req.body;
    if (is_active === undefined) {
      return res.status(400).json({ error: "is_active là bắt buộc" });
    }

    const result = await adminCouponService.updateCouponStatus(
      req.params.id,
      is_active
    );
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

const deleteCoupon = async (req, res) => {
  try {
    const result = await adminCouponService.deleteCoupon(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

module.exports = {
  getCoupons,
  getCouponById,
  createCoupon,
  updateCoupon,
  updateCouponStatus,
  deleteCoupon,
};
