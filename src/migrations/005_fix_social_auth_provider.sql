-- MIGRATION 005: Fix auth_provider for social-only accounts stuck at 'email' default
-- Những user có supabase_user_id (đã link social) nhưng KHÔNG có password_hash
-- → auth_provider đang sai là 'email' do COALESCE cũ → cập nhật lại theo supabase metadata
-- Chạy một lần duy nhất.

-- Cập nhật tài khoản Google (supabase_user_id bắt đầu bằng các pattern của Google)
-- Vì không lưu raw provider trong DB, ta chỉ set 'google' cho social-only users
-- mà auth_provider hiện là 'email' (default) — cần xác nhận thủ công nếu có nhiều provider

UPDATE users
SET auth_provider = 'google', updated_at = NOW()
WHERE
  supabase_user_id IS NOT NULL   -- đã link social
  AND password_hash IS NULL      -- không có password → thuần social
  AND auth_provider = 'email';   -- bị mắc kẹt ở default cũ

-- Kết quả: social-only users sẽ có auth_provider phản ánh đúng,
-- còn email/password users đã link Google vẫn giữ auth_provider = 'email'
