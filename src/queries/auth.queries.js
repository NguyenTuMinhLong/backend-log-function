"use strict";

/**
 * SQL queries liên quan đến refresh_tokens và user_otps
 * Được dùng bởi: auth.service.js
 */

// ── Refresh Tokens ─────────────────────────────────────────────────────────────

const REVOKE_ALL_REFRESH_TOKENS =
  `UPDATE refresh_tokens
   SET is_revoked = TRUE, revoked_at = NOW()
   WHERE user_id = $1 AND is_revoked = FALSE`;

const DELETE_EXPIRED_REFRESH_TOKENS =
  `DELETE FROM refresh_tokens
   WHERE user_id = $1 AND (is_revoked = TRUE OR expires_at < NOW())`;

const INSERT_REFRESH_TOKEN =
  `INSERT INTO refresh_tokens (user_id, token, expires_at)
   VALUES ($1, $2, $3)`;

const SELECT_REFRESH_TOKEN_WITH_USER =
  `SELECT rt.id AS refresh_token_id, u.*
   FROM refresh_tokens rt
   JOIN users u ON u.id = rt.user_id
   WHERE rt.token = $1
     AND rt.is_revoked = FALSE
     AND rt.expires_at > NOW()
   LIMIT 1
   FOR UPDATE`;

const REVOKE_REFRESH_TOKEN_BY_ID =
  `UPDATE refresh_tokens
   SET is_revoked = TRUE, revoked_at = NOW()
   WHERE id = $1`;

const REVOKE_REFRESH_TOKEN_BY_USER_AND_TOKEN =
  `UPDATE refresh_tokens
   SET is_revoked = TRUE, revoked_at = NOW()
   WHERE user_id = $1 AND token = $2 AND is_revoked = FALSE`;

// ── OTPs ───────────────────────────────────────────────────────────────────────

const INSERT_REGISTER_OTP =
  `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
   VALUES ($1, $2, 'register_verify', 'email', NOW() + INTERVAL '5 minutes')`;

const INSERT_RESET_PASSWORD_OTP =
  `INSERT INTO user_otps (user_id, otp_code, otp_type, channel, expires_at)
   VALUES ($1, $2, 'reset_password', 'email', NOW() + INTERVAL '5 minutes')`;

const SELECT_REGISTER_OTP =
  `SELECT * FROM user_otps
   WHERE user_id = $1
     AND otp_code = $2
     AND otp_type = 'register_verify'
     AND is_used = false
     AND expires_at > NOW()
   ORDER BY created_at DESC
   LIMIT 1`;

const SELECT_RESET_PASSWORD_OTP =
  `SELECT * FROM user_otps
   WHERE user_id = $1
     AND otp_code = $2
     AND otp_type = 'reset_password'
     AND is_used = false
     AND expires_at > NOW()
   ORDER BY created_at DESC
   LIMIT 1`;

const MARK_OTP_USED =
  `UPDATE user_otps SET is_used = true, used_at = NOW() WHERE id = $1`;

module.exports = {
  REVOKE_ALL_REFRESH_TOKENS,
  DELETE_EXPIRED_REFRESH_TOKENS,
  INSERT_REFRESH_TOKEN,
  SELECT_REFRESH_TOKEN_WITH_USER,
  REVOKE_REFRESH_TOKEN_BY_ID,
  REVOKE_REFRESH_TOKEN_BY_USER_AND_TOKEN,
  INSERT_REGISTER_OTP,
  INSERT_RESET_PASSWORD_OTP,
  SELECT_REGISTER_OTP,
  SELECT_RESET_PASSWORD_OTP,
  MARK_OTP_USED,
};
