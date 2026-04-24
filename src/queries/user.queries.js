"use strict";

/**
 * SQL queries liên quan đến bảng users
 * Được dùng bởi: admin.user.service.js, auth.service.js
 */

// ── Select ─────────────────────────────────────────────────────────────────────

const COUNT_USERS = (whereClause) =>
  `SELECT COUNT(*) AS total FROM users u ${whereClause}`;

const SELECT_USERS = (whereClause, orderBy, orderDirection, limitIdx, offsetIdx) =>
  `SELECT
     u.id, u.full_name, u.email, u.phone,
     u.role, u.status,
     u.email_verified, u.phone_verified,
     u.failed_login_attempts, u.locked_until,
     u.last_login_at, u.created_at, u.updated_at,
     CASE
       WHEN u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN TRUE
       ELSE FALSE
     END AS is_temporarily_locked
   FROM users u
   ${whereClause}
   ORDER BY ${orderBy} ${orderDirection}
   LIMIT $${limitIdx} OFFSET $${offsetIdx}`;

const SELECT_USER_BY_ID =
  `SELECT
     u.id, u.full_name, u.email, u.phone,
     u.role, u.status,
     u.email_verified, u.phone_verified,
     u.failed_login_attempts, u.locked_until,
     u.last_login_at, u.created_at, u.updated_at,
     CASE
       WHEN u.locked_until IS NOT NULL AND u.locked_until > NOW() THEN TRUE
       ELSE FALSE
     END AS is_temporarily_locked
   FROM users u
   WHERE u.id = $1`;

const SELECT_USER_FOR_STATUS_UPDATE =
  `SELECT id, full_name, email, role, status, failed_login_attempts, locked_until
   FROM users
   WHERE id = $1`;

const SELECT_USER_FOR_ROLE_UPDATE =
  `SELECT id, full_name, email, role, status
   FROM users
   WHERE id = $1`;

// ── Update ─────────────────────────────────────────────────────────────────────

const UPDATE_USER_STATUS =
  `UPDATE users
   SET status = $1,
       failed_login_attempts = $2,
       locked_until = $3,
       updated_at = NOW()
   WHERE id = $4
   RETURNING
     id, full_name, email, phone, role, status,
     email_verified, phone_verified,
     failed_login_attempts, locked_until,
     last_login_at, created_at, updated_at,
     CASE
       WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN TRUE
       ELSE FALSE
     END AS is_temporarily_locked`;

const UPDATE_USER_ROLE =
  `UPDATE users
   SET role = $1, updated_at = NOW()
   WHERE id = $2
   RETURNING
     id, full_name, email, phone, role, status,
     email_verified, phone_verified,
     failed_login_attempts, locked_until,
     last_login_at, created_at, updated_at,
     CASE
       WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN TRUE
       ELSE FALSE
     END AS is_temporarily_locked`;

// ── Auth dùng chung ────────────────────────────────────────────────────────────

const FIND_USER_BY_EMAIL =
  `SELECT * FROM users WHERE LOWER(email) = LOWER($1)`;

const FIND_USER_EMAIL_AUTH =
  `SELECT id, password_hash, auth_provider FROM users WHERE LOWER(email) = LOWER($1)`;

const FIND_USER_BY_PHONE =
  `SELECT id FROM users WHERE phone = $1`;

const FIND_USER_BY_ID_SIMPLE =
  `SELECT id, password_hash FROM users WHERE id = $1`;

const INSERT_USER =
  `INSERT INTO users (full_name, email, phone, password_hash)
   VALUES ($1, $2, $3, $4)
   RETURNING id, full_name, email, phone, email_verified`;

const SELECT_ME =
  `SELECT
     id, full_name, email, phone,
     role, status,
     email_verified, phone_verified,
     auth_provider, avatar_url,
     date_of_birth, gender, address,
     created_at,
     CASE
       WHEN password_hash IS NOT NULL THEN TRUE
       ELSE FALSE
     END AS has_password
   FROM users
   WHERE id = $1`;

const CHECK_PHONE_EXISTS_EXCLUDE_SELF =
  `SELECT id FROM users WHERE phone = $1 AND id <> $2`;

const UPDATE_USER_PROFILE =
  `UPDATE users
   SET full_name = $1,
       phone = $2,
       date_of_birth = $3,
       gender = $4,
       address = $5,
       avatar_url = $6,
       updated_at = NOW()
   WHERE id = $7
   RETURNING
     id, full_name, email, phone, role, status,
     email_verified, phone_verified,
     auth_provider, avatar_url,
     date_of_birth, gender, address,
     created_at, updated_at`;

const UPDATE_USER_PASSWORD =
  `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`;

const UPDATE_LOGIN_LOCK =
  `UPDATE users
   SET failed_login_attempts = $1,
       locked_until = NOW() + INTERVAL '15 minutes',
       updated_at = NOW()
   WHERE id = $2`;

const UPDATE_FAILED_ATTEMPTS =
  `UPDATE users
   SET failed_login_attempts = $1, updated_at = NOW()
   WHERE id = $2`;

const RESET_LOGIN_STATE =
  `UPDATE users
   SET failed_login_attempts = 0,
       locked_until = NULL,
       last_login_at = NOW(),
       updated_at = NOW()
   WHERE id = $1`;

const VERIFY_USER_EMAIL =
  `UPDATE users SET email_verified = true WHERE id = $1`;

module.exports = {
  COUNT_USERS,
  SELECT_USERS,
  SELECT_USER_BY_ID,
  SELECT_USER_FOR_STATUS_UPDATE,
  SELECT_USER_FOR_ROLE_UPDATE,
  UPDATE_USER_STATUS,
  UPDATE_USER_ROLE,
  FIND_USER_BY_EMAIL,
  FIND_USER_EMAIL_AUTH,
  FIND_USER_BY_PHONE,
  FIND_USER_BY_ID_SIMPLE,
  INSERT_USER,
  SELECT_ME,
  CHECK_PHONE_EXISTS_EXCLUDE_SELF,
  UPDATE_USER_PROFILE,
  UPDATE_USER_PASSWORD,
  UPDATE_LOGIN_LOCK,
  UPDATE_FAILED_ATTEMPTS,
  RESET_LOGIN_STATE,
  VERIFY_USER_EMAIL,
};
