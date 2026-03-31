const adminUserService = require("../services/admin.user.service");

const getUsers = async (req, res) => {
  try {
    const result = await adminUserService.getUsers(req.query);
    return res.json({
      message: "Lấy danh sách user thành công",
      ...result,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const getUserById = async (req, res) => {
  try {
    const user = await adminUserService.getUserById(req.params.id);
    return res.json({
      message: "Lấy chi tiết user thành công",
      data: user,
    });
  } catch (error) {
    return res.status(404).json({ error: error.message });
  }
};

const updateUserStatus = async (req, res) => {
  try {
    const { status } = req.body;

    if (!status) {
      return res.status(400).json({ error: "status là bắt buộc" });
    }

    const result = await adminUserService.updateUserStatus(
      req.params.id,
      status,
      req.user
    );

    return res.json({
      message: result.message,
      data: result.user,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

const updateUserRole = async (req, res) => {
  try {
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({ error: "role là bắt buộc" });
    }

    const result = await adminUserService.updateUserRole(
      req.params.id,
      role,
      req.user
    );

    return res.json({
      message: result.message,
      data: result.user,
    });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUserStatus,
  updateUserRole,
};