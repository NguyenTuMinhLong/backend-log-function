-- MIGRATION 011: Create Date Change Requests Table

CREATE TABLE IF NOT EXISTS date_change_requests (
  id                    BIGSERIAL PRIMARY KEY,
  request_code          VARCHAR(20)    NOT NULL UNIQUE,
  -- request_code format: DCR-YYYYMMDD-XXXXXX

  -- Liên kết booking
  booking_id            BIGINT         NOT NULL REFERENCES bookings(id),

  -- Chuyến bay cũ & mới
  old_flight_id         INT            NOT NULL REFERENCES flights(id),
  new_flight_id         INT            NOT NULL REFERENCES flights(id),

  -- Seat class (có thể đổi class luôn)
  old_seat_class       VARCHAR(20)    NOT NULL,
  new_seat_class       VARCHAR(20)    NOT NULL,

  -- Passenger affected (null = all passengers)
  passenger_ids         JSONB          NULL,
  -- Ví dụ: [1, 2, 3] hoặc null = tất cả

  -- Giá
  old_price            NUMERIC(12,2)  NOT NULL,
  new_price            NUMERIC(12,2)  NOT NULL,
  price_difference     NUMERIC(12,2)  NOT NULL,
  -- price_difference > 0: user phải trả thêm
  -- price_difference < 0: user được hoàn tiền

  -- Refund/Credit liên quan (nếu có)
  related_refund_id    BIGINT         REFERENCES refunds(id),

  -- Trạng thái
  status                VARCHAR(20)    NOT NULL DEFAULT 'pending',
  -- pending | approved | rejected | completed | cancelled

  -- Lý do
  reason               TEXT          NULL,
  -- Lý do user yêu cầu đổi

  admin_notes          TEXT          NULL,
  -- Ghi chú từ admin

  -- Ai tạo & duyệt
  requested_by         BIGINT         REFERENCES users(id),
  processed_by         BIGINT         REFERENCES users(id),

  -- Thời gian
  processed_at         TIMESTAMP      NULL,

  created_at           TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Ràng buộc
  CONSTRAINT chk_date_change_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed', 'cancelled')),
  CONSTRAINT chk_seat_class_valid
    CHECK (old_seat_class IN ('economy', 'business', 'first')),
  CONSTRAINT chk_new_seat_class_valid
    CHECK (new_seat_class IN ('economy', 'business', 'first'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_date_changes_booking_id
  ON date_change_requests (booking_id);
CREATE INDEX IF NOT EXISTS idx_date_changes_status
  ON date_change_requests (status);
CREATE INDEX IF NOT EXISTS idx_date_changes_requested_by
  ON date_change_requests (requested_by);

-- Unique: 1 booking chỉ có 1 pending request tại 1 thời điểm
CREATE UNIQUE INDEX IF NOT EXISTS idx_date_changes_unique_pending
  ON date_change_requests (booking_id)
  WHERE status = 'pending';

COMMENT ON TABLE date_change_requests IS 'Yêu cầu đổi ngày bay / rebooking';
