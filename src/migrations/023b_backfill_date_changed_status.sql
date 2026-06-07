-- MIGRATION 023b: Backfill date_changed status for existing approved date changes
-- Update bookings that already have an approved date_change_request

UPDATE bookings b
SET status = 'date_changed', updated_at = NOW()
WHERE b.id IN (
  SELECT DISTINCT dcr.booking_id
  FROM date_change_requests dcr
  WHERE dcr.status = 'approved'
)
AND b.status = 'confirmed';

-- Log how many rows updated
DO $$
DECLARE
  updated_count INT;
BEGIN
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RAISE NOTICE 'Updated % bookings to date_changed status', updated_count;
END $$;
