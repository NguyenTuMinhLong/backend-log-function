-- Migration 021: Bảng lưu email đăng ký nhận khuyến mãi
CREATE TABLE IF NOT EXISTS newsletter_subscribers (
  id                 BIGSERIAL    PRIMARY KEY,
  email              VARCHAR(255) NOT NULL UNIQUE,
  unsubscribe_token  VARCHAR(64)  UNIQUE,
  is_active          BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_newsletter_email ON newsletter_subscribers (LOWER(email));
CREATE INDEX IF NOT EXISTS idx_newsletter_token ON newsletter_subscribers (unsubscribe_token);
