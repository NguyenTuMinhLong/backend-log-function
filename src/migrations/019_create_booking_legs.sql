-- Migration 019: Tạo bảng booking_legs để lưu multi-leg flights
-- Mỗi booking có thể có nhiều legs (vd: đi DAD rồi mới đến SGN)

CREATE TABLE IF NOT EXISTS booking_legs (
  id              BIGSERIAL PRIMARY KEY,
  booking_id      BIGINT       NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  flight_id       INT          NOT NULL REFERENCES flights(id),
  leg_order       INT          NOT NULL,  -- 1 = chặng đầu, 2 = chặng thứ 2...
  direction       VARCHAR(10)  NOT NULL,  -- 'outbound' (chiều đi) | 'return' (chiều về)
  seat_class      VARCHAR(20)  NOT NULL,  -- economy | business | first
  created_at      TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_leg_direction CHECK (direction IN ('outbound', 'return'))
);

-- Index để query nhanh theo booking
CREATE INDEX IF NOT EXISTS idx_booking_legs_booking_id ON booking_legs (booking_id);
