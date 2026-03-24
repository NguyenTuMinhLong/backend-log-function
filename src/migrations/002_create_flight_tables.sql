-- =============================================
-- MIGRATION 002: Create Flight Search Tables
-- =============================================

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
  ('BL', 'Pacific Airlines'),
  ('TG', 'Thai Airways'),
  ('SQ', 'Singapore Airlines'),
  ('AK', 'AirAsia'),
  ('FD', 'Thai AirAsia'),
  ('TR', 'Scoot Airlines'),
  ('MI', 'SilkAir'),
  -- 🇰🇷 Hàn Quốc
  ('KE', 'Korean Air'),
  ('OZ', 'Asiana Airlines'),

  -- 🇦🇺 Úc
  ('QF', 'Qantas Airways'),
  ('JQ', 'Jetstar Airways'),

  -- 🇬🇧 Anh
  ('BA', 'British Airways'),

  -- 🇫🇷 Pháp
  ('AF', 'Air France'),

  -- 🇮🇹 Ý
  ('AZ', 'ITA Airways'),

  -- 🇺🇸 Mỹ
  ('AA', 'American Airlines'),
  ('DL', 'Delta Air Lines'),
  ('UA', 'United Airlines'),

  -- 🇪🇸 Tây Ban Nha
  ('IB', 'Iberia Airlines')
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
  ('BMV', 'Sân bay Buôn Ma Thuột',         'Buôn Ma Thuột'),
  ('BKK', 'Sân bay Quốc tế Suvarnabhumi',   'Bangkok',    'Thailand'),
  ('DMK', 'Sân bay Quốc tế Don Mueang',      'Bangkok',    'Thailand'),
  ('CNX', 'Sân bay Quốc tế Chiang Mai',      'Chiang Mai', 'Thailand'),
  ('HKT', 'Sân bay Quốc tế Phuket',          'Phuket',     'Thailand'),
  ('SIN', 'Sân bay Quốc tế Changi',          'Singapore',  'Singapore'),
  ('SEN', 'Sân bay Quốc tế Seletar',         'Singapore',  'Singapore'),
  ('ICN', 'Incheon International Airport', 'Seoul', 'South Korea'),
  ('SYD', 'Sydney Kingsford Smith Airport', 'Sydney', 'Australia'),
  ('LHR', 'Heathrow Airport', 'London', 'United Kingdom'),
  ('CDG', 'Charles de Gaulle Airport', 'Paris', 'France'),
  ('FCO', 'Leonardo da Vinci Airport', 'Rome', 'Italy'),
  ('JFK', 'John F. Kennedy International Airport', 'New York', 'USA'),
  ('LAX', 'Los Angeles International Airport', 'Los Angeles', 'USA'),
  ('MAD', 'Adolfo Suárez Madrid–Barajas Airport', 'Madrid', 'Spain')
ON CONFLICT (code) DO NOTHING;