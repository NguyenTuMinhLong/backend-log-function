-- MIGRATION 006: Add editable user profile fields

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS date_of_birth DATE NULL,
  ADD COLUMN IF NOT EXISTS gender VARCHAR(10) NULL,
  ADD COLUMN IF NOT EXISTS address TEXT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_users_gender;
ALTER TABLE users ADD CONSTRAINT chk_users_gender
  CHECK (gender IN ('male', 'female', 'other') OR gender IS NULL);
