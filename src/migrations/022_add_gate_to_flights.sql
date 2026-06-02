-- MIGRATION 022: Add gate column to flights table
-- Admin có thể set gate cho cả chuyến bay,
-- tự động sync xuống checkin_records khi thay đổi.

ALTER TABLE flights ADD COLUMN IF NOT EXISTS gate VARCHAR(10);

COMMENT ON COLUMN flights.gate IS 'Cổng khởi hành, VD: A12, B3. NULL = chưa xác định';
