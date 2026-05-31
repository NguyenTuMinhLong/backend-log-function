-- MIGRATION 018: Update date_change_requests status constraint
-- Add 'pending_otp' status for OTP verification flow

DO $$
BEGIN
  -- Drop old constraint
  ALTER TABLE date_change_requests DROP CONSTRAINT IF EXISTS chk_date_change_status;
  
  -- Add new constraint with pending_otp
  ALTER TABLE date_change_requests ADD CONSTRAINT chk_date_change_status
    CHECK (status IN ('pending', 'pending_otp', 'approved', 'rejected', 'completed', 'cancelled'));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Constraint update skipped: %', SQLERRM;
END $$;

-- Also update unique index to include pending_otp
DROP INDEX IF EXISTS idx_date_changes_unique_pending;
CREATE UNIQUE INDEX IF NOT EXISTS idx_date_changes_unique_pending
  ON date_change_requests (booking_id)
  WHERE status IN ('pending', 'pending_otp');

COMMENT ON COLUMN date_change_requests.status IS 'pending | pending_otp | approved | rejected | completed | cancelled';
