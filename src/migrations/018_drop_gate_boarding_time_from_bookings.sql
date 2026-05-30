-- =========================================================
-- MIGRATION 018: Xóa gate và boarding_time khỏi bảng bookings
--
-- Lý do: gate và boarding_time chỉ được tạo ra khi check-in,
-- nên chúng thuộc về bảng checkins, không phải bookings.
-- Các cột này trong bookings chưa bao giờ được ghi dữ liệu.
-- =========================================================

ALTER TABLE bookings DROP COLUMN IF EXISTS gate;
ALTER TABLE bookings DROP COLUMN IF EXISTS boarding_time;
