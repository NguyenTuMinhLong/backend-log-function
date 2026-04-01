const jwt = require("jsonwebtoken");
const pool = require("../config/db");

const loadUserAuthState = async (userId) => {
  const result = await pool.query(
    `SELECT id, full_name, email, phone, role, status, email_verified
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [userId]
  );

  if (result.rows.length === 0) {
    return { user: null, reason: "USER_NOT_FOUND" };
  }

  const user = result.rows[0];

  if (user.status !== "active") {
    return { user: null, reason: "ACCOUNT_DISABLED" };
  }

  return { user, reason: null };
};

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        error: "Unauthorized"
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { user, reason } = await loadUserAuthState(decoded.id);

    if (!user) {
      return res.status(reason === "ACCOUNT_DISABLED" ? 403 : 401).json({
        error: reason === "ACCOUNT_DISABLED" ? "Account is inactive or blocked" : "User not found",
        code: reason,
      });
    }

    req.user = user;

    next();
  } catch (err) {
    return res.status(401).json({
      success: false, 
      message: 'Bạn cần đăng nhập'
    });
  }
};

/**
 * Middleware authenticate tuỳ chọn (optional)
 * - Có token → decode, gán req.user
 * - Không có token → next() luôn (guest)
 */
const authenticateOptional = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const token   = authHeader.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const authState = await loadUserAuthState(decoded.id);
      req.user = authState.user;
      req.authErrorCode = authState.reason;
    }
  } catch (err) {
    // Token sai / hết hạn → coi như guest, không báo lỗi
    req.user = null;
  }
  next();
};

const requireAuth = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Bạn cần đăng nhập' });
  }
  next();
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Bạn cần đăng nhập' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Bạn không có quyền thực hiện thao tác này' });
    }
    next();
  };
};

module.exports = { authenticate, requireAuth, authorize, authenticateOptional };
