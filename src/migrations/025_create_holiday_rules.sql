-- ==========================================================
-- Migration: 025_create_holiday_rules
-- Thêm bảng recurring holiday rules cho solar/lunar/offset events
-- ==========================================================

CREATE TABLE IF NOT EXISTS holiday_rules (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  rule_type VARCHAR(30) NOT NULL DEFAULT 'single_day',
  calendar_type VARCHAR(20) NOT NULL DEFAULT 'solar',
  anchor_month INT NOT NULL,
  anchor_day INT NOT NULL,
  anchor_is_leap_month BOOLEAN DEFAULT false,
  offset_days INT DEFAULT 0,
  multiplier DECIMAL(3,2) DEFAULT 1.20,
  reason VARCHAR(255),
  priority INT DEFAULT 0,
  group_key VARCHAR(100),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  CONSTRAINT chk_holiday_rule_type CHECK (rule_type IN ('single_day', 'offset_from_anchor')),
  CONSTRAINT chk_holiday_calendar_type CHECK (calendar_type IN ('solar', 'lunar')),
  CONSTRAINT chk_holiday_anchor_month CHECK (anchor_month BETWEEN 1 AND 12),
  CONSTRAINT chk_holiday_anchor_day CHECK (anchor_day BETWEEN 1 AND 30)
);

COMMENT ON TABLE holiday_rules IS 'Recurring holiday rules cho các sự kiện solar/lunar/offset như Quốc khánh, Trung Thu, Tết';
COMMENT ON COLUMN holiday_rules.rule_type IS 'single_day hoặc offset_from_anchor';
COMMENT ON COLUMN holiday_rules.calendar_type IS 'solar hoặc lunar';
COMMENT ON COLUMN holiday_rules.group_key IS 'Dùng để gom holiday family như tet';

CREATE INDEX IF NOT EXISTS idx_holiday_rules_active
  ON holiday_rules(is_active, priority DESC)
  WHERE is_active = true;

INSERT INTO holiday_rules (
  name, rule_type, calendar_type, anchor_month, anchor_day, anchor_is_leap_month,
  offset_days, multiplier, reason, priority, group_key
) VALUES
  ('Quốc khánh', 'single_day', 'solar', 9, 2, false, 0, 1.35, 'kỳ nghỉ Quốc khánh', 200, 'national_day'),
  ('Giáng Sinh', 'single_day', 'solar', 12, 25, false, 0, 1.20, 'lễ Giáng Sinh', 120, 'christmas'),
  ('Trung Thu', 'single_day', 'lunar', 8, 15, false, 0, 1.18, 'dịp Trung Thu', 110, 'mid_autumn'),
  ('Tết Nguyên Đán', 'single_day', 'lunar', 1, 1, false, 0, 1.35, 'mùng 1 Tết cổ truyền', 300, 'tet'),
  ('Giao thừa', 'offset_from_anchor', 'lunar', 1, 1, false, -1, 1.40, 'đêm Giao thừa Tết', 320, 'tet'),
  ('Tết Nguyên Đán', 'offset_from_anchor', 'lunar', 1, 1, false, 1, 1.30, 'mùng 2 Tết cổ truyền', 290, 'tet'),
  ('Tết Nguyên Đán', 'offset_from_anchor', 'lunar', 1, 1, false, 2, 1.28, 'mùng 3 Tết cổ truyền', 280, 'tet')
ON CONFLICT DO NOTHING;
