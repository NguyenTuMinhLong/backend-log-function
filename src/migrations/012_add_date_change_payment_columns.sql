-- MIGRATION 012: Add payment_id to date_change_requests
-- For linking date change requests to their payment records

-- Add payment_id column
ALTER TABLE date_change_requests 
ADD COLUMN IF NOT EXISTS payment_id BIGINT REFERENCES payments(id);

-- Add payment_code column for easier lookup
ALTER TABLE date_change_requests 
ADD COLUMN IF NOT EXISTS payment_code VARCHAR(30);

-- Add paid_at column to track when payment was completed
ALTER TABLE date_change_requests 
ADD COLUMN IF NOT EXISTS paid_at TIMESTAMP NULL;

-- Update constraint to include new status
ALTER TABLE date_change_requests 
DROP CONSTRAINT IF EXISTS chk_date_change_status;

ALTER TABLE date_change_requests 
ADD CONSTRAINT chk_date_change_status
  CHECK (status IN ('pending', 'pending_otp', 'pending_payment', 'approved', 'rejected', 'completed', 'cancelled'));

-- Index for payment lookup
CREATE INDEX IF NOT EXISTS idx_date_changes_payment_id
  ON date_change_requests (payment_id);

CREATE INDEX IF NOT EXISTS idx_date_changes_payment_code
  ON date_change_requests (payment_code);

COMMENT ON COLUMN date_change_requests.payment_id IS 'Link to payments table for collecting price difference';
COMMENT ON COLUMN date_change_requests.payment_code IS 'Payment code (PAY-DC-xxx) for this date change';
COMMENT ON COLUMN date_change_requests.paid_at IS 'Timestamp when payment was completed';
