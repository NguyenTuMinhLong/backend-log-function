-- Migration 020: Thêm max_routes_per_airline để giới hạn số tuyến tạo ra
-- Giúp kiểm soát dung lượng DB (mặc định 5 route/hãng thay vì 20)
ALTER TABLE auto_flight_config
  ADD COLUMN IF NOT EXISTS max_routes_per_airline INT NOT NULL DEFAULT 5;
