-- MIGRATION 012: Add Guest Refund Columns
-- Adds support for guest (unauthenticated) refund requests

-- Guest identification
ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS guest_email VARCHAR(255);

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS guest_session_id VARCHAR(120);

-- Link tracking (for linking guest refunds to user account after login)
ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS is_linked BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE refunds
  ADD COLUMN IF NOT EXISTS linked_at TIMESTAMP;

-- Indexes for guest queries
CREATE INDEX IF NOT EXISTS idx_refunds_guest_session
  ON refunds (guest_session_id)
  WHERE guest_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refunds_guest_email
  ON refunds (guest_email)
  WHERE guest_email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_refunds_is_guest
  ON refunds (is_guest)
  WHERE is_guest = TRUE;

CREATE INDEX IF NOT EXISTS idx_refunds_is_linked
  ON refunds (is_linked)
  WHERE is_linked = FALSE;

-- Comments
COMMENT ON COLUMN refunds.is_guest IS 'True if refund was requested by guest (unauthenticated user)';
COMMENT ON COLUMN refunds.guest_email IS 'Email used for guest refund verification';
COMMENT ON COLUMN refunds.guest_session_id IS 'Guest session ID for tracking multiple guest refunds';
COMMENT ON COLUMN refunds.is_linked IS 'True if guest refund has been linked to a user account';
COMMENT ON COLUMN refunds.linked_at IS 'Timestamp when guest refund was linked to user account';
