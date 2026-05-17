-- =============================================
-- MIGRATION 012: Ancillary Services (SB-04)
-- Dịch vụ bổ sung: suất ăn, hành lý, bảo hiểm, phòng chờ, wifi
-- =============================================

-- 1. Bảng danh mục dịch vụ bổ sung (do admin quản lý)
CREATE TABLE IF NOT EXISTS ancillary_options (
  id           SERIAL PRIMARY KEY,
  type         VARCHAR(30)    NOT NULL,
  -- meal | baggage | insurance | lounge | wifi
  name         VARCHAR(100)   NOT NULL,
  description  TEXT,
  price        NUMERIC(12,2)  NOT NULL DEFAULT 0,
  currency     VARCHAR(5)     NOT NULL DEFAULT 'VND',
  unit         VARCHAR(30),
  -- VD: "per person", "per kg", "per flight"
  is_active    BOOLEAN        NOT NULL DEFAULT TRUE,
  meta         JSONB,
  -- Thông tin bổ sung tuỳ loại
  -- meal: { meal_type: "vegetarian" | "standard" | "kids" | "halal" }
  -- baggage: { kg: 5 | 10 | 20 }
  -- lounge: { includes: ["wifi","shower","food"] }
  created_at   TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMP      NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ancillary_type
    CHECK (type IN ('meal', 'baggage', 'insurance', 'lounge', 'wifi'))
);

-- 2. Bảng dịch vụ đã chọn theo từng hành khách trong booking
CREATE TABLE IF NOT EXISTS booking_ancillaries (
  id                  BIGSERIAL PRIMARY KEY,
  booking_id          BIGINT         NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  passenger_id        BIGINT         NOT NULL REFERENCES passengers(id) ON DELETE CASCADE,
  ancillary_option_id INT            NOT NULL REFERENCES ancillary_options(id),
  flight_type         VARCHAR(20)    NOT NULL DEFAULT 'outbound',
  -- outbound | return
  quantity            INT            NOT NULL DEFAULT 1,
  unit_price          NUMERIC(12,2)  NOT NULL,
  -- snapshot giá lúc chọn (tránh thay đổi giá sau)
  total_price         NUMERIC(12,2)  NOT NULL,
  -- quantity × unit_price
  status              VARCHAR(20)    NOT NULL DEFAULT 'selected',
  -- selected | confirmed | cancelled
  created_at          TIMESTAMP      NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP      NOT NULL DEFAULT NOW(),

  CONSTRAINT chk_ancillary_flight_type
    CHECK (flight_type IN ('outbound', 'return')),
  CONSTRAINT chk_ancillary_status
    CHECK (status IN ('selected', 'confirmed', 'cancelled')),
  CONSTRAINT chk_ancillary_quantity
    CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS idx_booking_ancillaries_booking_id
  ON booking_ancillaries (booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_ancillaries_passenger_id
  ON booking_ancillaries (passenger_id);

-- =============================================
-- SEED: Dữ liệu mẫu các dịch vụ bổ sung
-- =============================================

-- INSERT INTO ancillary_options (type, name, description, price, unit, meta) VALUES

--   -- 🍽️ Suất ăn
--   ('meal', 'Suất ăn tiêu chuẩn',    'Bữa ăn đầy đủ trên chuyến bay',          150000, 'per person', '{"meal_type":"standard"}'),
--   ('meal', 'Suất ăn chay',           'Bữa ăn chay / thuần thực vật',            150000, 'per person', '{"meal_type":"vegetarian"}'),
--   ('meal', 'Suất ăn Halal',          'Bữa ăn theo tiêu chuẩn Halal',            150000, 'per person', '{"meal_type":"halal"}'),
--   ('meal', 'Suất ăn trẻ em',         'Bữa ăn phù hợp cho trẻ em',              120000, 'per person', '{"meal_type":"kids"}'),

--   -- 🧳 Hành lý thêm
--   ('baggage', 'Hành lý thêm 5kg',   'Thêm 5kg hành lý ký gửi',                200000, 'per person', '{"kg":5}'),
--   ('baggage', 'Hành lý thêm 10kg',  'Thêm 10kg hành lý ký gửi',               380000, 'per person', '{"kg":10}'),
--   ('baggage', 'Hành lý thêm 20kg',  'Thêm 20kg hành lý ký gửi',               700000, 'per person', '{"kg":20}'),
--   ('baggage', 'Hành lý thêm 32kg',  'Thêm 32kg hành lý ký gửi',              1050000, 'per person', '{"kg":32}'),

--   -- 🛡️ Bảo hiểm
--   ('insurance', 'Bảo hiểm cơ bản',   'Bảo hiểm hành khách & hành lý cơ bản',   99000, 'per person', '{"coverage":["passenger","baggage"]}'),
--   ('insurance', 'Bảo hiểm toàn diện','Bảo hiểm y tế, hoãn/huỷ chuyến, hành lý',259000, 'per person', '{"coverage":["passenger","baggage","medical","cancellation"]}'),

--   -- 🛋️ Phòng chờ (Lounge)
--   ('lounge', 'Phòng chờ sân bay',    'Vào phòng chờ VIP tại sân bay khởi hành', 350000, 'per person', '{"includes":["wifi","food","shower"]}'),

--   -- 📶 Wifi
--   ('wifi', 'Wifi cơ bản',            '200MB - dùng cho chat & email',            99000, 'per person', '{"data_mb":200,"speed":"basic"}'),
--   ('wifi', 'Wifi nâng cao',          '1GB - streaming & làm việc',              199000, 'per person', '{"data_mb":1024,"speed":"high"}'),
--   ('wifi', 'Wifi không giới hạn',    'Không giới hạn dữ liệu suốt chuyến bay',  299000, 'per person', '{"data_mb":-1,"speed":"high"}')

-- ON CONFLICT DO NOTHING;