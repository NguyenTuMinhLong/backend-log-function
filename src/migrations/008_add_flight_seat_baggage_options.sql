-- MIGRATION 008: Store fixed baggage package prices per seat class

ALTER TABLE flight_seats
  ADD COLUMN IF NOT EXISTS extra_baggage_options JSONB NOT NULL DEFAULT '{"0":0,"5":0,"10":0,"20":0}'::jsonb;

UPDATE flight_seats
SET extra_baggage_options = jsonb_build_object(
  '0', 0,
  '5', COALESCE(extra_baggage_price, 0) * 5,
  '10', COALESCE(extra_baggage_price, 0) * 10,
  '20', COALESCE(extra_baggage_price, 0) * 20
)
WHERE extra_baggage_options IS NULL
   OR extra_baggage_options = '{"0":0,"5":0,"10":0,"20":0}'::jsonb;
