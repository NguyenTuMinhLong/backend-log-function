-- MIGRATION 012: Add Guest Support Columns to Refunds

-- Thêm các columns hỗ trợ guest refund (nếu chưa có)

ALTER TABLE refunds ADD COLUMN IF NOT EXISTS is_guest BOOLEAN DEFAULT FALSE;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255) NULL;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS guest_session_id VARCHAR(100) NULL;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS is_linked BOOLEAN DEFAULT FALSE;
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP NULL;

-- Thêm indexes nếu chưa có
CREATE INDEX IF NOT EXISTS idx_refunds_guest_session ON refunds (guest_session_id);
CREATE INDEX IF NOT EXISTS idx_refunds_guest_email ON refunds (guest_email);

COMMENT ON TABLE refunds IS 'Updated: Added guest support columns';
