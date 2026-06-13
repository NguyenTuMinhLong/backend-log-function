-- =============================================
-- MIGRATION 022: Create Search History Table
-- Lưu lịch sử tìm kiếm để hỗ trợ CU-05 Recommendation
-- =============================================

CREATE TABLE IF NOT EXISTS search_history (
  id               BIGSERIAL PRIMARY KEY,

  -- User đăng nhập
  user_id          BIGINT       REFERENCES users(id) ON DELETE CASCADE,
  -- Guest chưa đăng nhập
  session_id       VARCHAR(120) DEFAULT NULL,

  -- Thông tin tìm kiếm
  departure_code   VARCHAR(10)  NOT NULL,
  arrival_code     VARCHAR(10)  NOT NULL,
  departure_date   DATE         NOT NULL,
  return_date      DATE         DEFAULT NULL,
  seat_class       VARCHAR(20)  NOT NULL DEFAULT 'economy',
  adults           INT          NOT NULL DEFAULT 1,
  children         INT          NOT NULL DEFAULT 0,
  infants          INT          NOT NULL DEFAULT 0,

  -- Kết quả
  results_count    INT          DEFAULT 0,
  min_price_found  NUMERIC(12,2) DEFAULT NULL,

  created_at       TIMESTAMP    NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_search_seat_class
    CHECK (seat_class IN ('economy', 'business', 'first')),

  -- Phải có 1 trong 2
  CONSTRAINT chk_search_actor
    CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_search_history_user
  ON search_history (user_id, created_at DESC)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_history_session
  ON search_history (session_id, created_at DESC)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_search_history_route
  ON search_history (departure_code, arrival_code);