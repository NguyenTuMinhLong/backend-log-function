-- MIGRATION 012: Add payment linkage to date_change_requests
-- For linking date change requests to their payment records

-- Add payment_id column as text reference because payments.id schema is not defined by tracked migrations.
-- Application code already compares payments.id via ::text, so storing the linkage as text keeps V1 safe
-- until the payments table schema is formalized in versioned migrations.
ALTER TABLE date_change_requests 
ADD COLUMN IF NOT EXISTS payment_id VARCHAR(64);

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

-- Bug 3 Fix: Update unique index to include pending_payment status
DROP INDEX IF EXISTS idx_date_changes_unique_pending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_date_changes_unique_pending
  ON date_change_requests (booking_id)
  WHERE status IN ('pending', 'pending_otp', 'pending_payment');
