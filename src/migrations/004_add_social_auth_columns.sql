-- MIGRATION 004: Add social auth columns (Google / Facebook via Supabase)
-- Run this once on your database

-- 1. Cho phép password_hash NULL (social users không có password)
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- 2. Thêm các cột cho social login
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS supabase_user_id TEXT,
  ADD COLUMN IF NOT EXISTS auth_provider     VARCHAR(30) NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS avatar_url        TEXT;

-- 3. Unique index cho supabase_user_id
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_supabase_id
  ON users (supabase_user_id)
  WHERE supabase_user_id IS NOT NULL;

-- 4. Cập nhật constraint cho auth_provider
ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_auth_provider;
ALTER TABLE users ADD CONSTRAINT chk_users_auth_provider
  CHECK (auth_provider IN ('email', 'google', 'facebook', 'github'));
