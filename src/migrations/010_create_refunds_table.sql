-- MIGRATION 010: Create Refunds Table

-- 1. Thêm status mới vào bookings
DO $$
BEGIN
  -- Drop old constraint if exists
  ALTER TABLE bookings DROP CONSTRAINT IF EXISTS chk_booking_status;
  
  -- Add new constraint with refund statuses
  ALTER TABLE bookings ADD CONSTRAINT chk_booking_status
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired', 'refund_pending', 'refunded'));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Constraint already exists or error: %', SQLERRM;
END $$;

-- 2. Bảng refunds
CREATE TABLE IF NOT EXISTS refunds (
  id                    BIGSERIAL PRIMARY KEY,
  refund_code           VARCHAR(20)    NOT NULL UNIQUE,
  -- refund_code format: REF-YYYYMMDD-XXXXXX

  -- Liên kết booking (bắt buộc)
  booking_id            BIGINT         NOT NULL,

  -- Liên kết payment (nullable - không có FK vì có thể bookings không có payment)
  payment_id            BIGINT         NULL,

  -- Loại refund
  refund_type           VARCHAR(20)    NOT NULL DEFAULT 'full',
  -- full | partial_leg | partial_passenger

  -- Chi tiết refund
  requested_items       JSONB          NULL,
  -- Ví dụ: { "passenger_ids": [1,2], "legs": ["outbound"] }

  refund_amount         NUMERIC(12,2)  NOT NULL DEFAULT 0,
  admin_fee            NUMERIC(12,2)  NOT NULL DEFAULT 0,
  net_refund_amount     NUMERIC(12,2)  NOT NULL DEFAULT 0,

  refund_policy_applied JSONB          NULL,
  -- Lưu policy đã áp dụng: { "name": "high_refund", "hoursBefore": 24, "refundPercent": 80 }

  -- Trạng thái
  status                VARCHAR(20)    NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | processing | completed | cancelled | failed

  -- Lý do & ghi chú
  reason                TEXT          NULL,
  user_notes           TEXT          NULL,
  admin_notes          TEXT          NULL,

  -- Ai tạo & duyệt
  requested_by         BIGINT         NULL,
  processed_by         BIGINT         NULL,

  -- Thời gian
  processed_at         TIMESTAMP      NULL,
  completed_at         TIMESTAMP      NULL,

  created_at           TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Ràng buộc
  CONSTRAINT chk_refund_type
    CHECK (refund_type IN ('full', 'partial_leg', 'partial_passenger')),
  CONSTRAINT chk_refund_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'cancelled', 'failed')),
  CONSTRAINT chk_refund_amount_positive
    CHECK (refund_amount >= 0),
  CONSTRAINT chk_net_refund_positive
    CHECK (net_refund_amount >= 0)
);

-- Add FK constraints sau khi bảng đã tồn tại
ALTER TABLE refunds ADD CONSTRAINT refunds_booking_id_fkey 
  FOREIGN KEY (booking_id) REFERENCES bookings(id);

-- payment_id có thể null, nên chỉ add FK nếu cần thiết
-- Bỏ qua payment_id FK vì không phải lúc nào cũng có payment

-- Indexes cho refunds
CREATE INDEX IF NOT EXISTS idx_refunds_booking_id ON refunds (booking_id);
CREATE INDEX IF NOT EXISTS idx_refunds_status ON refunds (status);
CREATE INDEX IF NOT EXISTS idx_refunds_requested_by ON refunds (requested_by);
CREATE INDEX IF NOT EXISTS idx_refunds_created_at ON refunds (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_refunds_payment_id ON refunds (payment_id);

-- Unique constraint để prevent duplicate pending refunds
CREATE UNIQUE INDEX IF NOT EXISTS idx_refunds_unique_pending
  ON refunds (booking_id)
  WHERE status IN ('pending', 'approved', 'processing');

COMMENT ON TABLE refunds IS 'Theo dõi yêu cầu hoàn tiền';
