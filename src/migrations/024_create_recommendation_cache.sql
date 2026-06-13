-- =============================================
-- MIGRATION 024: Create Recommendation Cache Table
-- Cache kết quả recommendation để tránh tính lại mỗi lần gọi
-- =============================================

CREATE TABLE IF NOT EXISTS recommendation_cache (
  id              BIGSERIAL PRIMARY KEY,

  -- Ai nhận
  user_id         BIGINT          REFERENCES users(id) ON DELETE CASCADE,
  session_id      VARCHAR(120),

  -- Nội dung cache
  cache_key       VARCHAR(255)    NOT NULL,
  payload         JSONB           NOT NULL,

  -- Thời hạn
  expires_at      TIMESTAMP       NOT NULL,

  created_at      TIMESTAMP       NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_recommendation_actor
    CHECK (user_id IS NOT NULL OR session_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_recommendation_cache_user
  ON recommendation_cache (user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recommendation_cache_session
  ON recommendation_cache (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_recommendation_cache_key
  ON recommendation_cache (cache_key, expires_at);
