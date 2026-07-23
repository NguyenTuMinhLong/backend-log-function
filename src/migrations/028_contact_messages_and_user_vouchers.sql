-- 028: Hộp thư phản hồi (contact) + voucher cá nhân từ redeem membership
--      + gỡ ràng buộc hãng bay cho coupon WELCOME*

-- ── 1. Hộp thư liên hệ ────────────────────────────────────────────────────────
-- Trước đây form Contact chỉ gửi email tới hộp thư cá nhân → không lưu vết,
-- admin không xem/tra cứu được. Giờ lưu vào DB, admin đọc & trả lời từ trang admin.
CREATE TABLE IF NOT EXISTS contact_messages (
  id           BIGSERIAL PRIMARY KEY,
  name         VARCHAR(255) NOT NULL,
  email        VARCHAR(255) NOT NULL,
  subject      VARCHAR(100),
  message      TEXT         NOT NULL,
  status       VARCHAR(20)  NOT NULL DEFAULT 'new',   -- new | read | replied
  reply_body   TEXT,
  replied_at   TIMESTAMPTZ,
  replied_by   BIGINT REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status  ON contact_messages (status);
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages (created_at DESC);

-- ── 2. Voucher cá nhân ────────────────────────────────────────────────────────
-- redeemReward() trước đây chỉ sinh chuỗi "VOUCHER-XXXX" rồi trả về, không hề
-- INSERT vào vouchers → user không dùng được khi thanh toán ("Voucher không tồn tại")
-- và cũng không thấy trong My Coupons.
-- user_id NULL = voucher công khai (như hiện tại); user_id có giá trị = voucher
-- riêng của user đó, chỉ user đó thấy và dùng được.
ALTER TABLE vouchers
  ADD COLUMN IF NOT EXISTS user_id BIGINT REFERENCES users(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_vouchers_user_id ON vouchers (user_id) WHERE user_id IS NOT NULL;

-- ── 3. Gỡ ràng buộc hãng bay cho coupon WELCOME ───────────────────────────────
-- WELCOME30K/40K/50K đang gắn airline_id (2/3/5) nên getVoucherQuote báo
-- "Voucher không áp dụng cho hãng bay của booking này" với hầu hết chuyến bay.
UPDATE vouchers
SET airline_id = NULL, updated_at = NOW()
WHERE code LIKE 'WELCOME%' AND airline_id IS NOT NULL;

-- ── 4. Đóng các payment PENDING đã quá hạn ────────────────────────────────────
-- Không có tiến trình nào flip PENDING → EXPIRED nên giao dịch từ nhiều tháng
-- trước vẫn treo "Chờ thanh toán" trong Lịch sử giao dịch.
UPDATE payments
SET status = 'EXPIRED', expired_at = NOW(), updated_at = NOW()
WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at < NOW();
