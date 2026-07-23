const supabase = require("../config/supabase");
const pool     = require("../config/db");
const QU       = require("../queries/user.queries");

const authenticateSupabase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const token = authHeader.split(" ")[1];

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid Supabase token" });
    }

    const sbUser = data.user;

    const provider =
      sbUser.app_metadata?.provider ||
      sbUser.app_metadata?.providers?.[0] ||
      "email";

    const email = sbUser.email || null;

    const fullName =
      sbUser.user_metadata?.full_name ||
      sbUser.user_metadata?.name ||
      "User";

    const avatarUrl =
      sbUser.user_metadata?.avatar_url ||
      sbUser.user_metadata?.picture ||
      null;

    let result = await pool.query(QU.SELECT_USER_BY_SUPABASE_ID, [sbUser.id]);

    if (result.rows.length === 0 && email) {
      result = await pool.query(QU.SELECT_USER_BY_EMAIL_SOCIAL, [email]);
    }

    let user;

    if (result.rows.length === 0) {
      const inserted = await pool.query(
        QU.INSERT_SOCIAL_USER,
        [sbUser.id, fullName, email, provider, avatarUrl]
      );

      user = inserted.rows[0];
    } else {
      const currentUser = result.rows[0];

      if (currentUser.status !== "active") {
        return res.status(403).json({
          error: "Account is inactive or blocked",
          code: "ACCOUNT_DISABLED",
        });
      }

      // Merge tài khoản:
      // - supabase_user_id: chỉ set nếu chưa có (tránh ghi đè provider khác)
      // - auth_provider: cập nhật nếu tài khoản đang là 'email' mặc định (tức là đây là lần đầu link social)
      // - avatar_url: chỉ set nếu chưa có
      // - email_verified: luôn set true (đăng nhập qua Google/Facebook = email đã xác thực)
      const updated = await pool.query(
        QU.UPDATE_SOCIAL_USER,
        [sbUser.id, provider, avatarUrl, currentUser.id]
      );

      user = updated.rows[0];
    }

    req.supabaseUser = sbUser;
    req.user = user;

    next();
  } catch (err) {
    console.error("authenticateSupabase error:", err);
    return res.status(500).json({ error: "Authentication failed" });
  }
};

module.exports = { authenticateSupabase };
