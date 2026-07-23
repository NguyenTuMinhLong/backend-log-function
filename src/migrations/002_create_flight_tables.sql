-- MIGRATION 002: Create Flight Search Tables

-- 1. Bảng hãng hàng không
CREATE TABLE IF NOT EXISTS airlines (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(10)   NOT NULL UNIQUE,   -- VN, VJ, QH ...
  name        VARCHAR(100)  NOT NULL,
  logo_url    TEXT,
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- 2. Bảng sân bay
CREATE TABLE IF NOT EXISTS airports (
  id          SERIAL PRIMARY KEY,
  code        VARCHAR(10)   NOT NULL UNIQUE,   -- IATA: HAN, SGN, DAD ...
  name        VARCHAR(150)  NOT NULL,
  city        VARCHAR(100)  NOT NULL,
  country     VARCHAR(100)  NOT NULL DEFAULT 'Vietnam',
  timezone    VARCHAR(50)   NOT NULL DEFAULT 'Asia/Ho_Chi_Minh',
  is_active   BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMP     NOT NULL DEFAULT NOW()
);

-- 3. Bảng chuyến bay
CREATE TABLE IF NOT EXISTS flights (
  id                    SERIAL PRIMARY KEY,
  flight_number         VARCHAR(20)    NOT NULL,
  airline_id            INT            NOT NULL REFERENCES airlines(id),
  departure_airport_id  INT            NOT NULL REFERENCES airports(id),
  arrival_airport_id    INT            NOT NULL REFERENCES airports(id),
  departure_time        TIMESTAMP      NOT NULL,
  arrival_time          TIMESTAMP      NOT NULL,
  duration_minutes      INT            NOT NULL,
  status                VARCHAR(20)    NOT NULL DEFAULT 'scheduled',
  -- scheduled | delayed | cancelled | completed
  created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP      NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_airports_diff CHECK (departure_airport_id <> arrival_airport_id),
  CONSTRAINT chk_times         CHECK (arrival_time > departure_time)
);
-- Thêm cột is_active vào bảng flights (dùng cho soft delete)
ALTER TABLE flights ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

CREATE INDEX IF NOT EXISTS idx_flights_dep_arr_date
  ON flights (departure_airport_id, arrival_airport_id, departure_time);

-- 4. Bảng hạng ghế + giá vé của từng chuyến bay
CREATE TABLE IF NOT EXISTS flight_seats (
  id               SERIAL PRIMARY KEY,
  flight_id        INT            NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  class            VARCHAR(20)    NOT NULL,   -- economy | business | first
  total_seats      INT            NOT NULL DEFAULT 0,
  available_seats  INT            NOT NULL DEFAULT 0,
  base_price       NUMERIC(12,2)  NOT NULL,
  created_at       TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMP      NOT NULL DEFAULT NOW(),

  UNIQUE (flight_id, class),
  CONSTRAINT chk_seats CHECK (available_seats >= 0 AND available_seats <= total_seats),
  CONSTRAINT chk_price CHECK (base_price >= 0)
);
-- Thêm cột baggage vào flight_seats (ký gửi mặc định theo hạng)
ALTER TABLE flight_seats
  ADD COLUMN IF NOT EXISTS baggage_included_kg  INT  NOT NULL DEFAULT 0,   -- kg ký gửi miễn phí
  ADD COLUMN IF NOT EXISTS carry_on_kg          INT  NOT NULL DEFAULT 7,   -- kg xách tay
  ADD COLUMN IF NOT EXISTS extra_baggage_price  NUMERIC(10,2) NOT NULL DEFAULT 0; -- giá/kg thêm
 
-- Cập nhật mặc định theo hạng ghế
-- economy: 23kg, business: 32kg, first: 40kg
UPDATE flight_seats SET
  baggage_included_kg = CASE class
    WHEN 'economy'  THEN 23
    WHEN 'business' THEN 32
    WHEN 'first'    THEN 40
    ELSE 23
  END,
  carry_on_kg = CASE class
    WHEN 'economy'  THEN 7
    WHEN 'business' THEN 12
    WHEN 'first'    THEN 15
    ELSE 7
  END,
  extra_baggage_price = CASE class
    WHEN 'economy'  THEN 40000   
    WHEN 'business' THEN 40000
    WHEN 'first'    THEN 40000
    ELSE 40000
  END;

-- 5. Bảng theo dõi ghế đã được gán trong từng chuyến bay
CREATE TABLE IF NOT EXISTS flight_seat_assignments (
  id          BIGSERIAL PRIMARY KEY,
  flight_id   INT     NOT NULL REFERENCES flights(id) ON DELETE CASCADE,
  seat_number VARCHAR(10) NOT NULL,   -- VD: 1A, 12B, 33C
  class       VARCHAR(20) NOT NULL,
  status      VARCHAR(20) NOT NULL DEFAULT 'occupied',  -- occupied | available
  passenger_id BIGINT REFERENCES passengers(id) ON DELETE SET NULL,
  booking_id   BIGINT REFERENCES bookings(id)  ON DELETE SET NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 
  UNIQUE (flight_id, seat_number)
);
 
CREATE INDEX IF NOT EXISTS idx_seat_assignments_flight
  ON flight_seat_assignments (flight_id, class);