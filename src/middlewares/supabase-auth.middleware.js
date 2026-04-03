const supabase = require("../config/supabase");
const pool = require("../config/db");

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

    let result = await pool.query(
      `SELECT id, full_name, email, phone, role, status, email_verified, supabase_user_id, auth_provider, avatar_url
       FROM users
       WHERE supabase_user_id = $1
       LIMIT 1`,
      [sbUser.id]
    );

    if (result.rows.length === 0 && email) {
      result = await pool.query(
        `SELECT id, full_name, email, phone, role, status, email_verified, supabase_user_id, auth_provider, avatar_url
         FROM users
         WHERE LOWER(email) = LOWER($1)
         LIMIT 1`,
        [email]
      );
    }

    let user;

    if (result.rows.length === 0) {
      const inserted = await pool.query(
        `INSERT INTO users (
          supabase_user_id,
          full_name,
          email,
          password_hash,
          role,
          status,
          email_verified,
          auth_provider,
          avatar_url
        )
        VALUES ($1, $2, $3, NULL, 'customer', 'active', true, $4, $5)
        RETURNING id, full_name, email, phone, role, status, email_verified, supabase_user_id, auth_provider, avatar_url`,
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
        `UPDATE users
         SET
           supabase_user_id = COALESCE(supabase_user_id, $1),
           auth_provider    = CASE
                                -- Chỉ cập nhật provider nếu:
                                -- 1. Chưa có supabase_user_id (lần đầu link social) VÀ
                                -- 2. Chưa có password (tài khoản thuần social, không phải merge)
                                WHEN supabase_user_id IS NULL AND password_hash IS NULL THEN $2
                                ELSE auth_provider
                              END,
           avatar_url       = COALESCE(avatar_url, $3),
           email_verified   = true,
           updated_at       = NOW()
         WHERE id = $4
         RETURNING id, full_name, email, phone, role, status, email_verified, supabase_user_id, auth_provider, avatar_url`,
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
