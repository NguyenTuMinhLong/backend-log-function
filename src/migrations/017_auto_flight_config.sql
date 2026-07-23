-- Migration 017: Auto multi-airline flight generator config
CREATE TABLE IF NOT EXISTS auto_flight_config (
  id            SMALLINT    PRIMARY KEY DEFAULT 1,
  is_enabled    BOOLEAN     NOT NULL DEFAULT FALSE,
  start_date    DATE,
  end_date      DATE,
  flights_per_route INT     NOT NULL DEFAULT 3,
  advance_days  INT         NOT NULL DEFAULT 30,
  last_run_at   TIMESTAMPTZ,
  total_created INT         NOT NULL DEFAULT 0,
  CONSTRAINT single_row CHECK (id = 1)
);

INSERT INTO auto_flight_config (id) VALUES (1) ON CONFLICT DO NOTHING;
