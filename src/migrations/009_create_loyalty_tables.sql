-- Migration: 009_create_loyalty_tables.sql
-- Creates loyalty_notifications table and seed loyalty_tiers

-- ============================================================
-- LOYALTY NOTIFICATIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS public.loyalty_notifications (
  id         BIGSERIAL PRIMARY KEY,
  user_id    BIGINT NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type       VARCHAR(50) NOT NULL CHECK (
    type IN ('tier_upgrade', 'tier_downgrade', 'tier_reset', 'points_reset', 'earn', 'redeem')
  ),
  message    TEXT NOT NULL,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Index for querying user notifications
CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_user_id
  ON public.loyalty_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_loyalty_notifications_is_read
  ON public.loyalty_notifications(user_id, is_read) WHERE is_read = false;


-- ============================================================
-- SEED LOYALTY TIERS (if not exists)
-- ============================================================
INSERT INTO public.loyalty_tiers (name, min_points, multiplier, benefits)
VALUES
  ('Member',   0,      1.00, '["Ưu đãi 5% cho chuyến bay tiếp theo", "Tích điểm không giới hạn"]'),
  ('Silver',   5000,   1.25, '["Ưu đãi 7% cho chuyến bay tiếp theo", "Tích điểm nhanh hơn 25%", "Ưu tiên làm thủ tục"]'),
  ('Gold',     20000,  1.50, '["Ưu đãi 10% cho chuyến bay tiếp theo", "Tích điểm nhanh hơn 50%", "Hành lý ký gửi miễn phí 10kg", "Ưu tiên làm thủ tục và lên máy bay"]'),
  ('Platinum', 50000,  1.75, '["Ưu đãi 15% cho chuyến bay tiếp theo", "Tích điểm nhanh hơn 75%", "Hành lý ký gửi miễn phí 20kg", "Phòng chờ hạng thương gia miễn phí", "Nâng hạng ghế miễn phí 1 lần/năm"]')
ON CONFLICT (name) DO UPDATE SET
  min_points = EXCLUDED.min_points,
  multiplier = EXCLUDED.multiplier,
  benefits   = EXCLUDED.benefits;


-- ============================================================
-- SEED LOYALTY REWARDS (if not exists)
-- ============================================================
INSERT INTO public.loyalty_rewards (name, points_required, discount_amount, description, is_active)
VALUES
  ('Voucher 50.000 VNĐ',      1000,  50000,  'Giảm 50.000 VNĐ cho đơn hàng tiếp theo',     true),
  ('Voucher 100.000 VNĐ',     1800, 100000,  'Giảm 100.000 VNĐ cho đơn hàng tiếp theo',    true),
  ('Voucher 200.000 VNĐ',     3500, 200000,  'Giảm 200.000 VNĐ cho đơn hàng tiếp theo',    true),
  ('Voucher 500.000 VNĐ',     8000, 500000,  'Giảm 500.000 VNĐ cho đơn hàng tiếp theo',    true),
  ('Nâng hạng ghế Business',  5000,       0,  'Nâng cấp lên ghế Business cho 1 chuyến bay',  true),
  ('Phòng chờ VIP 1 lần',    3000,       0,  'Miễn phí vào phòng chờ hạng thương gia',   true)
ON CONFLICT DO NOTHING;
