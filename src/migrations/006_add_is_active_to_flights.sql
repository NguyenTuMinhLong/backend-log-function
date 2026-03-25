-- MIGRATION 006: Thêm cột is_active vào bảng flights (dùng cho soft delete)
ALTER TABLE flights ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;