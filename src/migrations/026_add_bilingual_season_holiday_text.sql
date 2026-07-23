-- Add English (name_en/reason_en) columns for bilingual season/holiday/price-override text
-- and backfill English translations for existing seed rows.

ALTER TABLE season_periods ADD COLUMN IF NOT EXISTS name_en VARCHAR(100);
ALTER TABLE season_periods ADD COLUMN IF NOT EXISTS reason_en VARCHAR(255);

ALTER TABLE holidays ADD COLUMN IF NOT EXISTS name_en VARCHAR(100);
ALTER TABLE holidays ADD COLUMN IF NOT EXISTS reason_en VARCHAR(255);

ALTER TABLE holiday_rules ADD COLUMN IF NOT EXISTS name_en VARCHAR(100);
ALTER TABLE holiday_rules ADD COLUMN IF NOT EXISTS reason_en VARCHAR(255);

ALTER TABLE price_overrides ADD COLUMN IF NOT EXISTS reason_en VARCHAR(255);

-- Backfill season_periods
UPDATE season_periods SET name_en='Summer', reason_en='school summer break'
  WHERE name='Mùa hè' AND reason='học sinh nghỉ hè';
UPDATE season_periods SET name_en='Autumn', reason_en='mild autumn season'
  WHERE name='Mùa thu' AND reason='mùa thu nhẹ nhàng';

-- Backfill holidays
UPDATE holidays SET name_en='New Year''s Day', reason_en='New Year''s Day'
  WHERE name='Tết Dương Lịch' AND reason='ngày đầu năm mới';
UPDATE holidays SET name_en='Christmas', reason_en='Christmas holiday'
  WHERE name='Giáng Sinh' AND reason='lễ Giáng Sinh';
UPDATE holidays SET name_en='Lunar New Year''s Eve', reason_en='Lunar New Year''s Eve'
  WHERE name='Giao thừa' AND reason='đêm Giao thừa Tết';
UPDATE holidays SET name_en='Lunar New Year', reason_en='Lunar New Year holiday'
  WHERE name='Tết Nguyên Đán' AND reason='Tết cổ truyền';

-- Backfill holiday_rules (match by name+reason, unique even for the 3 'Tết Nguyên Đán' rows)
UPDATE holiday_rules SET name_en='National Day', reason_en='National Day holiday'
  WHERE name='Quốc khánh' AND reason='kỳ nghỉ Quốc khánh';
UPDATE holiday_rules SET name_en='Christmas', reason_en='Christmas holiday'
  WHERE name='Giáng Sinh' AND reason='lễ Giáng Sinh';
UPDATE holiday_rules SET name_en='Mid-Autumn Festival', reason_en='Mid-Autumn Festival'
  WHERE name='Trung Thu' AND reason='dịp Trung Thu';
UPDATE holiday_rules SET name_en='Lunar New Year', reason_en='Lunar New Year Day 1'
  WHERE name='Tết Nguyên Đán' AND reason='mùng 1 Tết cổ truyền';
UPDATE holiday_rules SET name_en='Lunar New Year''s Eve', reason_en='Lunar New Year''s Eve'
  WHERE name='Giao thừa' AND reason='đêm Giao thừa Tết';
UPDATE holiday_rules SET name_en='Lunar New Year', reason_en='Lunar New Year Day 2'
  WHERE name='Tết Nguyên Đán' AND reason='mùng 2 Tết cổ truyền';
UPDATE holiday_rules SET name_en='Lunar New Year', reason_en='Lunar New Year Day 3'
  WHERE name='Tết Nguyên Đán' AND reason='mùng 3 Tết cổ truyền';
