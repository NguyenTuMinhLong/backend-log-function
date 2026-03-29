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
    WHEN 'economy'  THEN 32
    WHEN 'business' THEN 32
    WHEN 'first'    THEN 23
    ELSE 23
  END,
  carry_on_kg = CASE class
    WHEN 'economy'  THEN 12
    WHEN 'business' THEN 18
    WHEN 'first'    THEN 12
    ELSE 12
  END,
  extra_baggage_price = CASE class
    WHEN 'economy'  THEN 75000   -- 250k/kg thêm
    WHEN 'business' THEN 75000
    WHEN 'first'    THEN 50000        -- first: miễn phí thêm hành lý
    ELSE 50000
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


-- =============================================
-- SEED DATA
-- =============================================

-- Hãng hàng không
INSERT INTO airlines (code, name) VALUES
  -- 🇻🇳 Việt Nam
  ('VN', 'Vietnam Airlines'),
  ('VJ', 'VietJet Air'),
  ('QH', 'Bamboo Airways'),
  ('BL', 'Pacific Airlines'),
 
  -- 🇹🇭 Thái Lan
  ('TG', 'Thai Airways'),
  ('FD', 'Thai AirAsia'),
  ('WE', 'Thai Smile Airways'),
  ('SL', 'Lion Air Thailand'),
 
  -- 🇸🇬 Singapore
  ('SQ', 'Singapore Airlines'),
  ('TR', 'Scoot Airlines'),
  ('MI', 'SilkAir'),
 
  -- 🇲🇾 Malaysia
  ('MH', 'Malaysia Airlines'),
  ('AK', 'AirAsia'),
  ('D7', 'AirAsia X'),
 
  -- 🇮🇩 Indonesia
  ('GA', 'Garuda Indonesia'),
  ('JT', 'Lion Air'),
  ('QZ', 'Indonesia AirAsia'),
 
  -- 🇨🇳 Trung Quốc
  ('CA', 'Air China'),
  ('MU', 'China Eastern Airlines'),
  ('CZ', 'China Southern Airlines'),
  ('HU', 'Hainan Airlines'),
 
  -- 🇯🇵 Nhật Bản
  ('JL', 'Japan Airlines'),
  ('NH', 'All Nippon Airways'),
  ('MM', 'Peach Aviation'),
 
  -- 🇰🇷 Hàn Quốc
  ('KE', 'Korean Air'),
  ('OZ', 'Asiana Airlines'),
  ('7C', 'Jeju Air'),
 
  -- 🇺🇸 Mỹ
  ('AA', 'American Airlines'),
  ('DL', 'Delta Air Lines'),
  ('UA', 'United Airlines'),
  ('WN', 'Southwest Airlines'),
  ('B6', 'JetBlue Airways'),
 
  -- 🇬🇧 Anh
  ('BA', 'British Airways'),
  ('VS', 'Virgin Atlantic'),
  ('U2', 'easyJet'),
 
  -- 🇫🇷 Pháp
  ('AF', 'Air France'),
 
  -- 🇩🇪 Đức
  ('LH', 'Lufthansa'),
  ('EW', 'Eurowings'),
 
  -- 🇮🇹 Ý
  ('AZ', 'ITA Airways'),
 
  -- 🇪🇸 Tây Ban Nha
  ('IB', 'Iberia Airlines'),
  ('VY', 'Vueling Airlines'),
 
  -- 🇳🇱 Hà Lan
  ('KL', 'KLM Royal Dutch Airlines'),
 
  -- 🇦🇪 UAE
  ('EK', 'Emirates'),
  ('EY', 'Etihad Airways'),
  ('FZ', 'flydubai'),
 
  -- 🇶🇦 Qatar
  ('QR', 'Qatar Airways'),
 
  -- 🇦🇺 Úc
  ('QF', 'Qantas Airways'),
  ('JQ', 'Jetstar Airways'),
  ('VA', 'Virgin Australia'),
 
  -- 🇮🇳 Ấn Độ
  ('AI', 'Air India'),
  ('6E', 'IndiGo'),
 
  -- 🇹🇷 Thổ Nhĩ Kỳ
  ('TK', 'Turkish Airlines')
ON CONFLICT (code) DO NOTHING;

-- Sân bay
INSERT INTO airports (code, name, city, country, timezone) VALUES
  -- 🇻🇳 Việt Nam
  ('HAN', 'Sân bay Quốc tế Nội Bài',              'Hà Nội',         'Vietnam',        'Asia/Bangkok'),
  ('SGN', 'Sân bay Quốc tế Tân Sơn Nhất',         'Hồ Chí Minh',    'Vietnam',        'Asia/Bangkok'),
  ('DAD', 'Sân bay Quốc tế Đà Nẵng',              'Đà Nẵng',        'Vietnam',        'Asia/Bangkok'),
  ('CXR', 'Sân bay Quốc tế Cam Ranh',             'Nha Trang',      'Vietnam',        'Asia/Bangkok'),
  ('PQC', 'Sân bay Quốc tế Phú Quốc',             'Phú Quốc',       'Vietnam',        'Asia/Bangkok'),
  ('HUI', 'Sân bay Quốc tế Phú Bài',              'Huế',            'Vietnam',        'Asia/Bangkok'),
  ('VII', 'Sân bay Vinh',                          'Vinh',           'Vietnam',        'Asia/Bangkok'),
  ('BMV', 'Sân bay Buôn Ma Thuột',                 'Buôn Ma Thuột',  'Vietnam',        'Asia/Bangkok'),
 
  -- 🇹🇭 Thái Lan
  ('BKK', 'Sân bay Quốc tế Suvarnabhumi',          'Bangkok',        'Thailand',       'Asia/Bangkok'),
  ('DMK', 'Sân bay Quốc tế Don Mueang',            'Bangkok',        'Thailand',       'Asia/Bangkok'),
  ('CNX', 'Sân bay Quốc tế Chiang Mai',            'Chiang Mai',     'Thailand',       'Asia/Bangkok'),
  ('HKT', 'Sân bay Quốc tế Phuket',               'Phuket',         'Thailand',       'Asia/Bangkok'),
  ('USM', 'Sân bay Koh Samui',                     'Koh Samui',      'Thailand',       'Asia/Bangkok'),
 
  -- 🇸🇬 Singapore
  ('SIN', 'Sân bay Quốc tế Changi',               'Singapore',      'Singapore',      'Asia/Singapore'),
 
  -- 🇲🇾 Malaysia
  ('KUL', 'Sân bay Quốc tế Kuala Lumpur',         'Kuala Lumpur',   'Malaysia',       'Asia/Kuala_Lumpur'),
  ('PEN', 'Sân bay Quốc tế Penang',               'Penang',         'Malaysia',       'Asia/Kuala_Lumpur'),
  ('BKI', 'Sân bay Quốc tế Kota Kinabalu',        'Kota Kinabalu',  'Malaysia',       'Asia/Kuala_Lumpur'),
 
  -- 🇮🇩 Indonesia
  ('CGK', 'Sân bay Quốc tế Soekarno-Hatta',       'Jakarta',        'Indonesia',      'Asia/Jakarta'),
  ('DPS', 'Sân bay Quốc tế Ngurah Rai',           'Bali',           'Indonesia',      'Asia/Makassar'),
  ('SUB', 'Sân bay Quốc tế Juanda',               'Surabaya',       'Indonesia',      'Asia/Jakarta'),
 
  -- 🇨🇳 Trung Quốc
  ('PEK', 'Sân bay Quốc tế Capital Bắc Kinh',    'Bắc Kinh',       'China',          'Asia/Shanghai'),
  ('PKX', 'Sân bay Quốc tế Daxing Bắc Kinh',     'Bắc Kinh',       'China',          'Asia/Shanghai'),
  ('PVG', 'Sân bay Quốc tế Phố Đông Thượng Hải', 'Thượng Hải',     'China',          'Asia/Shanghai'),
  ('SHA', 'Sân bay Hồng Kiều Thượng Hải',         'Thượng Hải',     'China',          'Asia/Shanghai'),
  ('CAN', 'Sân bay Quốc tế Bạch Vân Quảng Châu', 'Quảng Châu',     'China',          'Asia/Shanghai'),
  ('CTU', 'Sân bay Quốc tế Thiên Phủ Thành Đô',  'Thành Đô',       'China',          'Asia/Shanghai'),
  ('HKG', 'Sân bay Quốc tế Hồng Kông',           'Hồng Kông',      'Hong Kong',      'Asia/Hong_Kong'),
 
  -- 🇯🇵 Nhật Bản
  ('NRT', 'Sân bay Quốc tế Narita',               'Tokyo',          'Japan',          'Asia/Tokyo'),
  ('HND', 'Sân bay Haneda Tokyo',                  'Tokyo',          'Japan',          'Asia/Tokyo'),
  ('KIX', 'Sân bay Quốc tế Kansai',               'Osaka',          'Japan',          'Asia/Tokyo'),
  ('ITM', 'Sân bay Itami Osaka',                   'Osaka',          'Japan',          'Asia/Tokyo'),
  ('NGO', 'Sân bay Quốc tế Chubu Centrair',       'Nagoya',         'Japan',          'Asia/Tokyo'),
  ('CTS', 'Sân bay Quốc tế New Chitose',          'Sapporo',        'Japan',          'Asia/Tokyo'),
  ('FUK', 'Sân bay Quốc tế Fukuoka',              'Fukuoka',        'Japan',          'Asia/Tokyo'),
 
  -- 🇰🇷 Hàn Quốc
  ('ICN', 'Sân bay Quốc tế Incheon',              'Seoul',          'South Korea',    'Asia/Seoul'),
  ('GMP', 'Sân bay Gimpo Seoul',                   'Seoul',          'South Korea',    'Asia/Seoul'),
  ('PUS', 'Sân bay Quốc tế Gimhae Busan',         'Busan',          'South Korea',    'Asia/Seoul'),
 
  -- 🇮🇳 Ấn Độ
  ('DEL', 'Sân bay Quốc tế Indira Gandhi',        'New Delhi',      'India',          'Asia/Kolkata'),
  ('BOM', 'Sân bay Quốc tế Chhatrapati Shivaji',  'Mumbai',         'India',          'Asia/Kolkata'),
  ('BLR', 'Sân bay Quốc tế Kempegowda',           'Bangalore',      'India',          'Asia/Kolkata'),
 
  -- 🇦🇪 UAE
  ('DXB', 'Sân bay Quốc tế Dubai',                'Dubai',          'UAE',            'Asia/Dubai'),
  ('AUH', 'Sân bay Quốc tế Abu Dhabi',            'Abu Dhabi',      'UAE',            'Asia/Dubai'),
 
  -- 🇶🇦 Qatar
  ('DOH', 'Sân bay Quốc tế Hamad',                'Doha',           'Qatar',          'Asia/Qatar'),
 
  -- 🇹🇷 Thổ Nhĩ Kỳ
  ('IST', 'Sân bay Istanbul',                      'Istanbul',       'Turkey',         'Europe/Istanbul'),
  ('SAW', 'Sân bay Sabiha Gökçen Istanbul',        'Istanbul',       'Turkey',         'Europe/Istanbul'),
 
  -- 🇬🇧 Anh
  ('LHR', 'Sân bay Heathrow London',               'London',         'United Kingdom', 'Europe/London'),
  ('LGW', 'Sân bay Gatwick London',                'London',         'United Kingdom', 'Europe/London'),
  ('STN', 'Sân bay Stansted London',               'London',         'United Kingdom', 'Europe/London'),
  ('MAN', 'Sân bay Manchester',                    'Manchester',     'United Kingdom', 'Europe/London'),
 
  -- 🇫🇷 Pháp
  ('CDG', 'Sân bay Charles de Gaulle Paris',       'Paris',          'France',         'Europe/Paris'),
  ('ORY', 'Sân bay Orly Paris',                    'Paris',          'France',         'Europe/Paris'),
  ('NCE', 'Sân bay Nice Côte d''Azur',             'Nice',           'France',         'Europe/Paris'),
 
  -- 🇩🇪 Đức
  ('FRA', 'Sân bay Quốc tế Frankfurt',             'Frankfurt',      'Germany',        'Europe/Berlin'),
  ('MUC', 'Sân bay Quốc tế Munich',               'Munich',         'Germany',        'Europe/Berlin'),
  ('BER', 'Sân bay Quốc tế Berlin Brandenburg',   'Berlin',         'Germany',        'Europe/Berlin'),
 
  -- 🇮🇹 Ý
  ('FCO', 'Sân bay Leonardo da Vinci Rome',        'Rome',           'Italy',          'Europe/Rome'),
  ('MXP', 'Sân bay Quốc tế Malpensa Milan',       'Milan',          'Italy',          'Europe/Rome'),
  ('VCE', 'Sân bay Marco Polo Venice',             'Venice',         'Italy',          'Europe/Rome'),
 
  -- 🇪🇸 Tây Ban Nha
  ('MAD', 'Sân bay Adolfo Suárez Madrid-Barajas',  'Madrid',         'Spain',          'Europe/Madrid'),
  ('BCN', 'Sân bay El Prat Barcelona',             'Barcelona',      'Spain',          'Europe/Madrid'),
 
  -- 🇳🇱 Hà Lan
  ('AMS', 'Sân bay Amsterdam Schiphol',            'Amsterdam',      'Netherlands',    'Europe/Amsterdam'),
 
  -- 🇺🇸 Mỹ
  ('JFK', 'Sân bay Quốc tế John F. Kennedy',      'New York',       'USA',            'America/New_York'),
  ('EWR', 'Sân bay Quốc tế Newark Liberty',       'New York',       'USA',            'America/New_York'),
  ('LAX', 'Sân bay Quốc tế Los Angeles',          'Los Angeles',    'USA',            'America/Los_Angeles'),
  ('SFO', 'Sân bay Quốc tế San Francisco',        'San Francisco',  'USA',            'America/Los_Angeles'),
  ('ORD', 'Sân bay Quốc tế O''Hare Chicago',      'Chicago',        'USA',            'America/Chicago'),
  ('ATL', 'Sân bay Quốc tế Hartsfield-Jackson',   'Atlanta',        'USA',            'America/New_York'),
  ('DFW', 'Sân bay Quốc tế Dallas/Fort Worth',    'Dallas',         'USA',            'America/Chicago'),
  ('MIA', 'Sân bay Quốc tế Miami',                'Miami',          'USA',            'America/New_York'),
  ('SEA', 'Sân bay Quốc tế Seattle-Tacoma',       'Seattle',        'USA',            'America/Los_Angeles'),
 
  -- 🇦🇺 Úc
  ('SYD', 'Sân bay Kingsford Smith Sydney',        'Sydney',         'Australia',      'Australia/Sydney'),
  ('MEL', 'Sân bay Tullamarine Melbourne',         'Melbourne',      'Australia',      'Australia/Melbourne'),
  ('BNE', 'Sân bay Quốc tế Brisbane',             'Brisbane',       'Australia',      'Australia/Brisbane'),
  ('PER', 'Sân bay Quốc tế Perth',                'Perth',          'Australia',      'Australia/Perth')
ON CONFLICT (code) DO NOTHING;