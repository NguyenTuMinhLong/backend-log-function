-- =========================================================
-- MIGRATION: 013_create_seat_and_checkin_tables
-- Tao bang seat_pricing va checkins cho chuc nang:
-- - Seat selection (chon ghe tra phi them)
-- - Check-in online hien thi boarding pass
-- =========================================================

-- =========================================================
-- 1. Bang seat_pricing - Luu gia tri them cho tung loai ghe
-- =========================================================
CREATE TABLE IF NOT EXISTS seat_pricing (
  id              BIGSERIAL PRIMARY KEY,
  flight_id       BIGINT  REFERENCES flights(id) ON DELETE CASCADE,
  seat_class      VARCHAR(20) NOT NULL,  -- economy, business, first
  position        VARCHAR(20) NOT NULL,  -- window, aisle, middle, extra_legroom
  extra_price     DECIMAL(10,2) NOT NULL DEFAULT 0,  -- Phi them VND
  is_active       BOOLEAN   DEFAULT true,
  created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  UNIQUE (flight_id, seat_class, position)
);

-- Index for faster lookup
CREATE INDEX IF NOT EXISTS idx_seat_pricing_flight_class
  ON seat_pricing (flight_id, seat_class);

-- =========================================================
-- 2. Bang checkins - Theo doi check-in cua hanh khach
-- =========================================================
CREATE TABLE IF NOT EXISTS checkins (
  id                BIGSERIAL PRIMARY KEY,
  booking_id         BIGINT  REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_id      BIGINT  REFERENCES passengers(id) ON DELETE CASCADE,
  flight_type       VARCHAR(10) NOT NULL,  -- outbound, return
  boarding_pass_code VARCHAR(50) UNIQUE NOT NULL,  -- VD: VJ8PKSL-P1
  sequence_number   INT,   -- So thu tu len may bay
  checked_in_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  status            VARCHAR(20) DEFAULT 'checked_in',  -- checked_in, boarded, cancelled
  gate              VARCHAR(10),
  boarding_time     TIMESTAMP,
  created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_checkins_booking
  ON checkins (booking_id);

CREATE INDEX IF NOT EXISTS idx_checkins_passenger
  ON checkins (passenger_id);

CREATE INDEX IF NOT EXISTS idx_checkins_code
  ON checkins (boarding_pass_code);

-- =========================================================
-- 3. Update bookings table - Them truong seat_selection_type
-- =========================================================
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS seat_selection_type VARCHAR(20) DEFAULT 'random';  -- random, chosen

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS seat_extra_fee DECIMAL(10,2) DEFAULT 0;

-- =========================================================
-- 4. Update passengers table - Them truong cho checkin
-- =========================================================
ALTER TABLE passengers 
ADD COLUMN IF NOT EXISTS checked_in BOOLEAN DEFAULT false;

ALTER TABLE passengers 
ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMP;

-- =========================================================
-- 5. Update bookings table - Them truong cho boarding info
-- =========================================================
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS gate VARCHAR(10);

ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS boarding_time TIMESTAMP;

-- =========================================================
-- 6. Insert default seat pricing (neu chua co)
-- =========================================================
-- Don gian hoa: Chi 2 loai ghe
-- - Window (A, F): 10,000 VND
-- - Standard (B, C, D, E): 5,000 VND
INSERT INTO seat_pricing (flight_id, seat_class, position, extra_price)
SELECT NULL, class, position, price
FROM (
  VALUES 
    ('economy', 'window', 10000),
    ('economy', 'standard', 5000),
    ('business', 'window', 10000),
    ('business', 'standard', 5000),
    ('first', 'window', 10000),
    ('first', 'standard', 5000)
) AS defaults(class, position, price)
WHERE NOT EXISTS (
  SELECT 1 FROM seat_pricing WHERE flight_id IS NULL
);
