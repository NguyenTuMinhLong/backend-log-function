# Vivudee Rewards - Membership & Points System

**Phiên bản:** 1.0  
**Ngày cập nhật:** 13/05/2026  
**Mục tiêu:** Hệ thống tích điểm, nâng hạng và đổi điểm đơn giản, dễ mở rộng cho dự án Vivudee.

---

## 1. Giới thiệu

- **Tên chương trình:** Vivudee Rewards (hoặc Vivudee Miles)
- **Cách tính điểm chính:** `points = FLOOR(total_ticket_price / 10.000) × tier_multiplier`
- **Mục tiêu:** Khuyến khích khách hàng bay thường xuyên, tăng retention.

---

## 2. Hệ thống Tier (4 cấp)

| Tier       | Min Points (Rolling 12 tháng) | Multiplier | Đặc quyền nổi bật khi Redeem                  |
|------------|-------------------------------|------------|-----------------------------------------------|
| Member     | 0                             | ×1.0       | -                                             |
| Silver     | 15.000                        | ×1.25      | Giảm 10% vé + miễn 1kg hành lý                |
| Gold       | 40.000                        | ×1.5       | Giảm 15% vé + miễn 20kg hành lý               |
| Platinum   | 80.000                        | ×1.75      | Giảm 20% vé + free upgrade (nếu có)           |

---

## 3. Database Schema (Đã chạy)

```sql
-- 1. Bảng tiers
CREATE TABLE loyalty_tiers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(30) UNIQUE,
  min_points INTEGER,
  multiplier NUMERIC(3,2),
  benefits JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Tài khoản loyalty
CREATE TABLE user_loyalty (
  id SERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE REFERENCES users(id),
  tier_id INTEGER REFERENCES loyalty_tiers(id),
  total_points BIGINT DEFAULT 0,
  current_points BIGINT DEFAULT 0 CHECK (current_points >= 0),
  membership_number VARCHAR(20) UNIQUE,
  tier_expiry_date DATE,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Lịch sử giao dịch
CREATE TABLE loyalty_transactions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT REFERENCES users(id),
  type VARCHAR(20) CHECK (type IN ('earn','redeem','expire','adjustment')),
  amount INTEGER,
  booking_id BIGINT REFERENCES bookings(id),
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


INSERT INTO loyalty_tiers (name, min_points, multiplier, benefits) VALUES
('Member', 0, 1.00, '[{"name":"Tích điểm cơ bản","value":"1x"}]'),
('Silver', 15000, 1.25, '[{"name":"Giảm 10% vé","value":"10%"},{"name":"Miễn 1kg hành lý","value":"+1kg"}]'),
('Gold', 40000, 1.5, '[{"name":"Giảm 15% vé","value":"15%"},{"name":"Miễn 20kg hành lý","value":"20kg"}]'),
('Platinum', 80000, 1.75, '[{"name":"Giảm 20% vé","value":"20%"},{"name":"Free upgrade","value":"Upgrade"}]')
ON CONFLICT (name) DO NOTHING;


