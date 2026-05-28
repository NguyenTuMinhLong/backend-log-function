-- Tạo bảng lịch bay định kỳ (flight schedule templates)
CREATE TABLE IF NOT EXISTS flight_schedules (
  id                    SERIAL PRIMARY KEY,
  flight_number         VARCHAR(20) NOT NULL,
  airline_id            INTEGER NOT NULL REFERENCES airlines(id),
  departure_airport_id  INTEGER NOT NULL REFERENCES airports(id),
  arrival_airport_id    INTEGER NOT NULL REFERENCES airports(id),
  departure_time        TIME NOT NULL,
  arrival_time          TIME NOT NULL,
  duration_minutes      INTEGER NOT NULL CHECK (duration_minutes > 0),
  days_of_week          INTEGER[] NOT NULL,
  start_date            DATE NOT NULL,
  end_date              DATE,
  seats                 JSONB NOT NULL DEFAULT '[]',
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flight_schedules_airline    ON flight_schedules(airline_id);
CREATE INDEX IF NOT EXISTS idx_flight_schedules_departure  ON flight_schedules(departure_airport_id);
CREATE INDEX IF NOT EXISTS idx_flight_schedules_arrival    ON flight_schedules(arrival_airport_id);
CREATE INDEX IF NOT EXISTS idx_flight_schedules_active     ON flight_schedules(is_active);
