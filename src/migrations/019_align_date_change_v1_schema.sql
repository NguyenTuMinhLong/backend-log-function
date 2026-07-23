-- MIGRATION 019: Align date change V1 schema with per-leg workflow

-- 1) Add flight_leg for per-leg request tracking
ALTER TABLE date_change_requests
ADD COLUMN IF NOT EXISTS flight_leg VARCHAR(20);

UPDATE date_change_requests
SET flight_leg = COALESCE(NULLIF(TRIM(flight_leg), ''), 'outbound')
WHERE flight_leg IS NULL OR TRIM(flight_leg) = '';

ALTER TABLE date_change_requests
ALTER COLUMN flight_leg SET NOT NULL;

-- 2) Normalize allowed statuses for V1
ALTER TABLE date_change_requests
DROP CONSTRAINT IF EXISTS chk_date_change_status;

ALTER TABLE date_change_requests
ADD CONSTRAINT chk_date_change_status
  CHECK (status IN ('pending_otp', 'pending_payment', 'pending', 'approved', 'rejected', 'completed', 'cancelled'));

-- 3) Add flight_leg validation
ALTER TABLE date_change_requests
DROP CONSTRAINT IF EXISTS chk_date_change_flight_leg;

ALTER TABLE date_change_requests
ADD CONSTRAINT chk_date_change_flight_leg
  CHECK (flight_leg IN ('outbound'));

-- 4) Replace booking-wide active-request uniqueness with per-leg uniqueness
DROP INDEX IF EXISTS idx_date_changes_unique_pending;

CREATE UNIQUE INDEX IF NOT EXISTS idx_date_changes_unique_pending_leg
  ON date_change_requests (booking_id, flight_leg)
  WHERE status IN ('pending_otp', 'pending_payment', 'pending');

-- 5) Helpful lookup indexes for leg-based filtering
CREATE INDEX IF NOT EXISTS idx_date_changes_booking_leg
  ON date_change_requests (booking_id, flight_leg);

CREATE INDEX IF NOT EXISTS idx_date_changes_status_leg
  ON date_change_requests (status, flight_leg);

COMMENT ON COLUMN date_change_requests.flight_leg IS 'Stable booking leg identifier for date-change V1 (currently outbound only)';
COMMENT ON COLUMN date_change_requests.status IS 'pending_otp | pending_payment | pending | approved | rejected | completed | cancelled';
