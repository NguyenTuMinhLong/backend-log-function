-- Backfill missing name_en/reason_en for the 'Tết Nguyên Đán' season_periods row
-- (missed by migration 026, which only covered 'Mùa hè' and 'Mùa thu').

UPDATE season_periods SET name_en='Lunar New Year', reason_en='Lunar New Year holiday'
  WHERE name='Tết Nguyên Đán' AND reason='Tết cổ truyền' AND name_en IS NULL;
