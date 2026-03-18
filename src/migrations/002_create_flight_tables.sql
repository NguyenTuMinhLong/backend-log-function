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
 
-- =============================================
-- SEED DATA
-- =============================================
 
-- Hãng hàng không
INSERT INTO airlines (code, name) VALUES
  ('VN', 'Vietnam Airlines'),
  ('VJ', 'VietJet Air'),
  ('QH', 'Bamboo Airways'),
  ('BL', 'Pacific Airlines')
ON CONFLICT (code) DO NOTHING;
 
-- Sân bay
INSERT INTO airports (code, name, city) VALUES
  ('HAN', 'Sân bay Quốc tế Nội Bài',       'Hà Nội'),
  ('SGN', 'Sân bay Quốc tế Tân Sơn Nhất',  'Hồ Chí Minh'),
  ('DAD', 'Sân bay Quốc tế Đà Nẵng',       'Đà Nẵng'),
  ('CXR', 'Sân bay Quốc tế Cam Ranh',      'Nha Trang'),
  ('PQC', 'Sân bay Quốc tế Phú Quốc',      'Phú Quốc'),
  ('HUI', 'Sân bay Quốc tế Phú Bài',       'Huế'),
  ('VII', 'Sân bay Vinh',                  'Vinh'),
  ('BMV', 'Sân bay Buôn Ma Thuột',         'Buôn Ma Thuột')
ON CONFLICT (code) DO NOTHING;
 
-- Chuyến bay mẫu (ngày mai)
DO $$
DECLARE
  v_vn   INT; v_vj INT; v_qh INT;
  v_han  INT; v_sgn INT; v_dad INT; v_cxr INT;
  v_fid  INT;
  v_dep  TIMESTAMP;
BEGIN
  SELECT id INTO v_vn  FROM airlines WHERE code = 'VN';
  SELECT id INTO v_vj  FROM airlines WHERE code = 'VJ';
  SELECT id INTO v_qh  FROM airlines WHERE code = 'QH';
  SELECT id INTO v_han FROM airports WHERE code = 'HAN';
  SELECT id INTO v_sgn FROM airports WHERE code = 'SGN';
  SELECT id INTO v_dad FROM airports WHERE code = 'DAD';
  SELECT id INTO v_cxr FROM airports WHERE code = 'CXR';
 
  -- ---- HAN -> SGN ----
 
  -- VN123 | 07:00 | 2h
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '7 hours';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('VN123', v_vn, v_han, v_sgn, v_dep, v_dep + INTERVAL '120 min', 120)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  150, 120, 899000),
    (v_fid, 'business',  24,  20, 2500000);
 
  -- VJ456 | 10:30 | 1h55m
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '10 hours 30 minutes';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('VJ456', v_vj, v_han, v_sgn, v_dep, v_dep + INTERVAL '115 min', 115)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  180,  50, 599000),
    (v_fid, 'business',  12,   5, 1800000);
 
  -- QH789 | 14:00 | 2h05m
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '14 hours';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('QH789', v_qh, v_han, v_sgn, v_dep, v_dep + INTERVAL '125 min', 125)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  160,  80, 749000),
    (v_fid, 'business',  20,  15, 2100000);
 
  -- VN999 | 19:00 | sold out economy
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '19 hours';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('VN999', v_vn, v_han, v_sgn, v_dep, v_dep + INTERVAL '120 min', 120)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  150,   0, 1200000),
    (v_fid, 'business',  24,  10, 3000000);
 
  -- ---- SGN -> HAN ----
 
  -- VN321 | 08:00
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '8 hours';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('VN321', v_vn, v_sgn, v_han, v_dep, v_dep + INTERVAL '120 min', 120)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  150, 100, 950000),
    (v_fid, 'business',  24,  18, 2600000);
 
  -- VJ654 | 15:30
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '15 hours 30 minutes';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('VJ654', v_vj, v_sgn, v_han, v_dep, v_dep + INTERVAL '115 min', 115)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  180,  90, 649000),
    (v_fid, 'business',  12,   8, 1900000);
 
  -- ---- HAN -> DAD ----
 
  -- VN201 | 09:00
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '9 hours';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('VN201', v_vn, v_han, v_dad, v_dep, v_dep + INTERVAL '80 min', 80)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  150,  70, 699000),
    (v_fid, 'business',  24,  12, 1800000);
 
  -- ---- SGN -> DAD ----
 
  -- QH301 | 11:00
  v_dep := DATE_TRUNC('day', NOW() + INTERVAL '1 day') + INTERVAL '11 hours';
  INSERT INTO flights (flight_number, airline_id, departure_airport_id, arrival_airport_id,
                       departure_time, arrival_time, duration_minutes)
  VALUES ('QH301', v_qh, v_sgn, v_dad, v_dep, v_dep + INTERVAL '65 min', 65)
  RETURNING id INTO v_fid;
  INSERT INTO flight_seats (flight_id, class, total_seats, available_seats, base_price) VALUES
    (v_fid, 'economy',  160, 110, 499000),
    (v_fid, 'business',  20,  10, 1500000);
 
END $$;