-- MIGRATION 003: Create Booking Tables

-- 1. Bảng bookings
CREATE TABLE IF NOT EXISTS bookings (
  id                    BIGSERIAL PRIMARY KEY,
  booking_code          VARCHAR(10)    NOT NULL UNIQUE,   -- Mã PNR VD: ABC12345
  user_id               BIGINT         REFERENCES users(id) ON DELETE SET NULL,
  -- user_id = NULL --> Khách vãng lai (guest)

  -- Chuyến đi (bắt buộc nhập)
  outbound_flight_id    INT            NOT NULL REFERENCES flights(id),
  outbound_seat_class   VARCHAR(20)    NOT NULL,

  -- Chuyến về (optional - khứ hồi) -- nếu không thứ hồi thì không cần nhập và nó NULL
  return_flight_id      INT            REFERENCES flights(id),
  return_seat_class     VARCHAR(20),
  trip_type             VARCHAR(20)    NOT NULL DEFAULT 'one_way',
  -- one_way | thay thành round_trip nếu khứ hồi

  -- Thông tin hành khách tổng
  total_adults          INT            NOT NULL DEFAULT 1,
  total_children        INT            NOT NULL DEFAULT 0,
  total_infants         INT            NOT NULL DEFAULT 0,

  -- Giá tiền
  base_price            NUMERIC(12,2)  NOT NULL,   -- giá gốc 1 người lớn
  total_price           NUMERIC(12,2)  NOT NULL,   -- tổng tiền

  -- Trạng thái
  status                VARCHAR(20)    NOT NULL DEFAULT 'pending',
  -- pending | confirmed | cancelled | expired

  -- Thông tin liên hệ (cho guest hoặc override)
  contact_email         VARCHAR(150)   NOT NULL,
  contact_phone         VARCHAR(20),
  contact_name          VARCHAR(100)   NOT NULL,

  -- Giữ ghế
  held_until            TIMESTAMP      NULL,  -- thời gian giữ ghế (30 phút)

  created_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_booking_trip_type
    CHECK (trip_type IN ('one_way', 'round_trip')),
  CONSTRAINT chk_booking_status
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'expired')),
  CONSTRAINT chk_booking_seat_class
    CHECK (outbound_seat_class IN ('economy', 'business', 'first')),
  CONSTRAINT chk_booking_adults
    CHECK (total_adults >= 1),
  CONSTRAINT chk_booking_children
    CHECK (total_children >= 0),
  CONSTRAINT chk_booking_infants
    CHECK (total_infants >= 0)
);

CREATE INDEX IF NOT EXISTS idx_bookings_user_id
  ON bookings (user_id);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_code
  ON bookings (booking_code);
CREATE INDEX IF NOT EXISTS idx_bookings_status_held
  ON bookings (status, held_until);

-- 2. Bảng passengers (thông tin từng hành khách trong booking)
CREATE TABLE IF NOT EXISTS passengers (
  id              BIGSERIAL PRIMARY KEY,
  booking_id      BIGINT         NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  flight_type     VARCHAR(20)    NOT NULL DEFAULT 'outbound',
  -- outbound | return (mỗi chuyến lưu riêng)

  passenger_type  VARCHAR(20)    NOT NULL,
  -- adult | child | infant

  full_name       VARCHAR(100)   NOT NULL,
  date_of_birth   DATE           NULL,
  gender          VARCHAR(10)    NULL,
  -- male | female | other

  nationality     VARCHAR(50)    NULL,
  passport_number VARCHAR(30)    NULL,
  passport_expiry DATE           NULL,

  seat_number     VARCHAR(10)    NULL,   -- VD: 12A (Tự sinh)

  created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT chk_passenger_type
    CHECK (passenger_type IN ('adult', 'child', 'infant')),
  CONSTRAINT chk_passenger_gender
    CHECK (gender IN ('male', 'female', 'other') OR gender IS NULL),
  CONSTRAINT chk_passenger_flight_type
    CHECK (flight_type IN ('outbound', 'return'))
);

CREATE INDEX IF NOT EXISTS idx_passengers_booking_id
  ON passengers (booking_id);

-- Thêm cột baggage vào passengers (hành lý của từng người)
ALTER TABLE passengers
  ADD COLUMN IF NOT EXISTS baggage_kg        INT  NOT NULL DEFAULT 0,  -- kg ký gửi chọn (0 = dùng mặc định)
  ADD COLUMN IF NOT EXISTS extra_baggage_kg  INT  NOT NULL DEFAULT 0,  -- kg mua thêm
  ADD COLUMN IF NOT EXISTS baggage_price     NUMERIC(10,2) NOT NULL DEFAULT 0; -- tiền hành lý thêm