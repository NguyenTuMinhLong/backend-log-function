-- MIGRATION 023: Fix column types + add date_changed status
-- Fix "value too long for type character varying(20)" errors

-- 1. Mở rộng admin_notes (có thể vẫn VARCHAR(20) trong một số môi trường)
ALTER TABLE date_change_requests
  ALTER COLUMN admin_notes TYPE TEXT;

-- 2. Mở rộng reason trong date_change_requests (phòng ngừa)
ALTER TABLE date_change_requests
  ALTER COLUMN reason TYPE TEXT;

-- 3. Thêm status 'date_changed' vào bookings (giữ tất cả statuses hiện có)
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_booking_status;
ALTER TABLE bookings ADD CONSTRAINT chk_booking_status
  CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'date_changed', 'refunded', 'refund_pending'));

-- 4. Thêm status 'date_changed' vào date_change_requests nếu cần
ALTER TABLE date_change_requests DROP CONSTRAINT IF EXISTS chk_date_change_status;
ALTER TABLE date_change_requests ADD CONSTRAINT chk_date_change_status
  CHECK (status IN ('pending', 'pending_otp', 'pending_payment', 'approved', 'rejected', 'completed', 'cancelled'));

-- 5. Đảm bảo payments.payment_code đủ dài cho PAY-DC-xxx format (28 chars)
ALTER TABLE payments
  ALTER COLUMN payment_code TYPE VARCHAR(50);

-- Migration 023 complete: Fix VARCHAR overflow + add date_changed booking status
