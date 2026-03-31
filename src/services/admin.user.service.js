const pool = require("../config/db");

const VALID_ROLES = ["customer", "staff", "admin"];
const VALID_STATUSES = ["active", "inactive", "blocked"];

const sanitizeUser = (row) => ({
  id: row.id,
  full_name: row.full_name,
  email: row.email,
  phone: row.phone,
  role: row.role,
  status: row.status,
  email_verified: row.email_verified,
  phone_verified: row.phone_verified,
  failed_login_attempts: row.failed_login_attempts,
  locked_until: row.locked_until,
  last_login_at: row.last_login_at,
  created_at: row.created_at,
  updated_at: row.updated_at,
  is_temporarily_locked: row.is_temporarily_locked,
});

const getUsers = async (params) => {
  const {
    page = 1,
    limit = 10,
    search,
    role,
    status,
    email_verified,
    sort_by = "created_at",
    sort_order = "desc",
  } = params;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 10, 1);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const values = [];
  let idx = 1;

  if (search) {
    conditions.push(
      `(u.full_name ILIKE $${idx} OR u.email ILIKE $${idx} OR COALESCE(u.phone, '') ILIKE $${idx})`
    );
    values.push(`%${search}%`);
    idx++;
  }

  if (role) {
    if (!VALID_ROLES.includes(role)) {
      throw new Error(`role phải là: ${VALID_ROLES.join(", ")}`);
    }
    conditions.push(`u.role = $${idx}`);
    values.push(role);
    idx++;
  }

  if (status) {
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`status phải là: ${VALID_STATUSES.join(", ")}`);
    }
    conditions.push(`u.status = $${idx}`);
    values.push(status);
    idx++;
  }

  if (email_verified !== undefined && email_verified !== "") {
    const verified = email_verified === true || email_verified === "true";
    conditions.push(`u.email_verified = $${idx}`);
    values.push(verified);
    idx++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const allowedSortFields = {
    id: "u.id",
    full_name: "u.full_name",
    email: "u.email",
    role: "u.role",
    status: "u.status",
    created_at: "u.created_at",
    updated_at: "u.updated_at",
    last_login_at: "u.last_login_at",
  };

  const orderBy = allowedSortFields[sort_by] || "u.created_at";
  const orderDirection =
    String(sort_order).toLowerCase() === "asc" ? "ASC" : "DESC";

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM users u
    ${whereClause}
  `;

  const countResult = await pool.query(countQuery, values);
  const total = parseInt(countResult.rows[0].total, 10);

  const dataQuery = `
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.phone,
      u.role,
      u.status,
      u.email_verified,
      u.phone_verified,
      u.failed_login_attempts,
      u.locked_until,
      u.last_login_at,
      u.created_at,
      u.updated_at,
      CASE
        WHEN u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN TRUE
        ELSE FALSE
      END AS is_temporarily_locked
    FROM users u
    ${whereClause}
    ORDER BY ${orderBy} ${orderDirection}
    LIMIT $${idx} OFFSET $${idx + 1}
  `;

  const dataResult = await pool.query(dataQuery, [...values, limitNum, offset]);

  return {
    data: dataResult.rows.map(sanitizeUser),
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      total_pages: Math.ceil(total / limitNum),
    },
  };
};

const getUserById = async (userId) => {
  const result = await pool.query(
    `
    SELECT
      u.id,
      u.full_name,
      u.email,
      u.phone,
      u.role,
      u.status,
      u.email_verified,
      u.phone_verified,
      u.failed_login_attempts,
      u.locked_until,
      u.last_login_at,
      u.created_at,
      u.updated_at,
      CASE
        WHEN u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN TRUE
        ELSE FALSE
      END AS is_temporarily_locked
    FROM users u
    WHERE u.id = $1
    `,
    [userId]
  );

  if (result.rows.length === 0) {
    throw new Error("Không tìm thấy user");
  }

  return sanitizeUser(result.rows[0]);
};

const updateUserStatus = async (userId, status, currentAdmin) => {
  if (!VALID_STATUSES.includes(status)) {
    throw new Error(`status phải là: ${VALID_STATUSES.join(", ")}`);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT
        id,
        full_name,
        email,
        role,
        status,
        failed_login_attempts,
        locked_until
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (existingResult.rows.length === 0) {
      throw new Error("Không tìm thấy user");
    }

    const existingUser = existingResult.rows[0];

    if (
      parseInt(existingUser.id, 10) === parseInt(currentAdmin.id, 10) &&
      status !== "active"
    ) {
      throw new Error("Bạn không thể tự khóa hoặc vô hiệu hóa chính mình");
    }

    const shouldResetLoginState = status === "active";
    const nextFailedLoginAttempts = shouldResetLoginState
      ? 0
      : existingUser.failed_login_attempts;
    const nextLockedUntil = shouldResetLoginState
      ? null
      : existingUser.locked_until;

    const result = await client.query(
      `
      UPDATE users
      SET
        status = $1,
        failed_login_attempts = $2,
        locked_until = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING
        id,
        full_name,
        email,
        phone,
        role,
        status,
        email_verified,
        phone_verified,
        failed_login_attempts,
        locked_until,
        last_login_at,
        created_at,
        updated_at,
        CASE
          WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN TRUE
          ELSE FALSE
        END AS is_temporarily_locked
      `,
      [status, nextFailedLoginAttempts, nextLockedUntil, userId]
    );

    await client.query("COMMIT");

    let message = "Cập nhật trạng thái user thành công";
    if (status === "blocked") message = "Đã khóa user";
    if (status === "inactive") message = "Đã chuyển user sang inactive";
    if (status === "active") message = "Đã mở khóa / kích hoạt user";

    return {
      message,
      user: sanitizeUser(result.rows[0]),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

const updateUserRole = async (userId, role, currentAdmin) => {
  if (!VALID_ROLES.includes(role)) {
    throw new Error(`role phải là: ${VALID_ROLES.join(", ")}`);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
      SELECT id, full_name, email, role, status
      FROM users
      WHERE id = $1
      `,
      [userId]
    );

    if (existingResult.rows.length === 0) {
      throw new Error("Không tìm thấy user");
    }

    const existingUser = existingResult.rows[0];

    if (
      parseInt(existingUser.id, 10) === parseInt(currentAdmin.id, 10) &&
      role !== "admin"
    ) {
      throw new Error("Bạn không thể tự thay đổi role của chính mình");
    }

    const result = await client.query(
      `
      UPDATE users
      SET
        role = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING
        id,
        full_name,
        email,
        phone,
        role,
        status,
        email_verified,
        phone_verified,
        failed_login_attempts,
        locked_until,
        last_login_at,
        created_at,
        updated_at,
        CASE
          WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN TRUE
          ELSE FALSE
        END AS is_temporarily_locked
      `,
      [role, userId]
    );

    await client.query("COMMIT");

    return {
      message: "Cập nhật role user thành công",
      user: sanitizeUser(result.rows[0]),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getUsers,
  getUserById,
  updateUserStatus,
  updateUserRole,
};