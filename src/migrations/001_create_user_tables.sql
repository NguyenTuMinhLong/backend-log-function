-- MIGRATION 001: Create User Tables

DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS user_otps CASCADE;
DROP TABLE IF EXISTS users CASCADE;
 
CREATE TABLE users (
    id BIGSERIAL PRIMARY KEY,
    full_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) NOT NULL,
    phone VARCHAR(20),
    password_hash TEXT NOT NULL,
    role VARCHAR(20) NOT NULL DEFAULT 'customer',
    status VARCHAR(20) NOT NULL DEFAULT 'active',
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    failed_login_attempts INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP NULL,
    last_login_at TIMESTAMP NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_users_phone UNIQUE (phone),
    CONSTRAINT chk_users_role
        CHECK (role IN ('customer', 'admin', 'staff')),
    CONSTRAINT chk_users_status
        CHECK (status IN ('active', 'inactive', 'blocked'))
);
 
CREATE UNIQUE INDEX uq_users_email_lower ON users (LOWER(email));
 
CREATE TABLE user_otps (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    otp_code VARCHAR(10) NOT NULL,
    otp_type VARCHAR(30) NOT NULL,
    channel VARCHAR(20) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    attempt_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    used_at TIMESTAMP NULL,
    CONSTRAINT chk_user_otps_type
        CHECK (otp_type IN ('register_verify', 'login_verify', 'reset_password')),
    CONSTRAINT chk_user_otps_channel
        CHECK (channel IN ('email', 'sms'))
);
 
CREATE TABLE refresh_tokens (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP NULL
);