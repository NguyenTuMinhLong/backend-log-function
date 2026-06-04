-- ==========================================================
-- Migration: 024_create_season_holiday_config
-- Tạo bảng cho season/holiday configuration và price history
-- ==========================================================

-- =====================================================
-- 1. SEASON PERIODS - Mùa cao điểm theo khoảng thời gian
-- =====================================================
CREATE TABLE IF NOT EXISTS season_periods (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  start_month INT NOT NULL,
  start_day INT,
  end_month INT NOT NULL,
  end_day INT,
  multiplier DECIMAL(3,2) DEFAULT 1.20,
  reason VARCHAR(255),
  priority INT DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT chk_month_range CHECK (start_month BETWEEN 1 AND 12 AND end_month BETWEEN 1 AND 12),
  CONSTRAINT chk_day_range CHECK (
    (start_day IS NULL OR (start_day BETWEEN 1 AND 31)) AND
    (end_day IS NULL OR (end_day BETWEEN 1 AND 31))
  )
);

COMMENT ON TABLE season_periods IS 'Khoảng thời gian mùa cao điểm (VD: Mùa hè 1/6-31/8)';
COMMENT ON COLUMN season_periods.multiplier IS 'Hệ số nhân giá cho mùa này (1.0 = off-peak, 1.5 = peak cao)';

-- =====================================================
-- 2. HOLIDAYS - Ngày lễ cụ thể
-- =====================================================
CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  date DATE NOT NULL,
  year INT,
  month INT GENERATED ALWAYS AS (EXTRACT(MONTH FROM date)) STORED,
  day INT GENERATED ALWAYS AS (EXTRACT(DAY FROM date)) STORED,
  multiplier DECIMAL(3,2) DEFAULT 1.20,
  reason VARCHAR(255),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT uq_holiday_date_year UNIQUE (date, year)
);

COMMENT ON TABLE holidays IS 'Ngày lễ cụ thể (VD: 25/12/2026 Giáng Sinh)';
COMMENT ON COLUMN holidays.year IS 'Năm cụ thể. NULL = lặp lại hàng năm (VD: 25/12)';

-- =====================================================
-- 3. PRICE HISTORY - Snapshot giá theo ngày (optional)
-- =====================================================
CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  flight_id INT NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  seat_class VARCHAR(20) DEFAULT 'economy',
  base_price INT NOT NULL,
  calculated_price INT NOT NULL,
  available_seats INT,
  total_seats INT,
  occupancy_rate DECIMAL(5,2),
  day_of_week_mult DECIMAL(3,2),
  advance_mult DECIMAL(3,2),
  demand_mult DECIMAL(3,2),
  season_mult DECIMAL(3,2) DEFAULT 1.00,
  holiday_mult DECIMAL(3,2) DEFAULT 1.00,
  record_date DATE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  
  CONSTRAINT uq_price_history_flight_date UNIQUE (flight_id, seat_class, record_date),
  CONSTRAINT chk_valid_prices CHECK (calculated_price > 0 AND base_price > 0)
);

COMMENT ON TABLE price_history IS 'Lịch sử giá theo ngày - dùng để phân tích trend (optional)';

-- =====================================================
-- 4. INDEXES
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_season_active ON season_periods(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_holidays_date ON holidays(date);
CREATE INDEX IF NOT EXISTS idx_holidays_reusable ON holidays(year) WHERE year IS NULL;
CREATE INDEX IF NOT EXISTS idx_price_history_flight ON price_history(flight_id, record_date DESC);
CREATE INDEX IF NOT EXISTS idx_price_history_date ON price_history(record_date);

-- =====================================================
-- 5. SEED DATA - Season & Holidays 2026 (idempotent)
-- =====================================================
INSERT INTO season_periods (name, start_month, start_day, end_month, end_day, multiplier, reason, priority) VALUES
  ('Mùa hè', 6, 1, 8, 31, 1.30, 'học sinh nghỉ hè', 100)
ON CONFLICT DO NOTHING;

INSERT INTO season_periods (name, start_month, start_day, end_month, end_day, multiplier, reason, priority) VALUES
  ('Mùa thu', 9, 1, 9, 30, 1.00, 'mùa thu nhẹ nhàng', 0)
ON CONFLICT DO NOTHING;

-- Holidays - lặp lại hàng năm
INSERT INTO holidays (name, date, year, multiplier, reason) VALUES
  ('Tết Dương Lịch', '2026-01-01', NULL, 1.15, 'ngày đầu năm mới'),
  ('Giáng Sinh', '2026-12-25', NULL, 1.30, 'lễ Giáng Sinh')
ON CONFLICT (date, year) DO UPDATE SET
  multiplier = EXCLUDED.multiplier,
  reason = EXCLUDED.reason;

-- Holidays - ngày cố định trong năm 2026
INSERT INTO holidays (name, date, year, multiplier, reason) VALUES
  ('Giao thừa', '2026-02-16', 2026, 1.40, 'đêm Giao thừa Tết'),
  ('Tết Nguyên Đán', '2026-02-17', 2026, 1.30, 'Tết cổ truyền'),
  ('Tết Nguyên Đán', '2026-02-18', 2026, 1.30, 'Tết cổ truyền'),
  ('Tết Nguyên Đán', '2026-02-19', 2026, 1.30, 'Tết cổ truyền')
ON CONFLICT (date, year) DO UPDATE SET
  multiplier = EXCLUDED.multiplier,
  reason = EXCLUDED.reason;
