# LOYALTY / MEMBERSHIP SYSTEM

## 1. OVERVIEW

Hệ thống tích điểm và thăng hạng cho khách hàng của ứng dụng đặt vé máy bay. Mỗi lần booking, user được cộng điểm dựa trên số tiền thanh toán và hạng thành viên hiện tại.

---

## 2. POINTS SYSTEM — 3 CỘT ĐIỂM

```
ACTION             lifetime    tier      current
────────────────────────────────────────────────
Earn (booking)     + pts       + pts     + pts
Redeem reward      —           —         - pts
Cancel / refund    —           - pts     - pts  → check downgrade
Cron annual reset  —           - 20%     —      → check downgrade
```

| Cột | Vai trò | Giảm khi nào? |
|-----|---------|--------------|
| `lifetime_points` | Chỉ cộng, không bao giờ giảm → lịch sử vĩnh viễn, báo cáo | ❌ Không bao giờ |
| `tier_points` | Dùng để xét tier + cronjob penalty | ❌ Không khi redeem, ✅ Khi cancel/refund/cron |
| `current_points` | Điểm user có thể tiêu để đổi reward | ❌ Không ảnh hưởng tier |

---

## 3. TIER SYSTEM

### 3.1 Cấu hình

| Hạng | Điểm tối thiểu (tier_points) | Hệ số nhân (multiplier) |
|------|------------------------------|-------------------------|
| Member | 0 | ×1.0 |
| Silver | 5,000 | ×1.25 |
| Gold | 20,000 | ×1.5 |
| Platinum | 50,000 | ×1.75 |

### 3.2 Cách tính điểm khi earn

```
basePoints   = floor(totalPrice / 10,000)
pointsEarned = floor(basePoints × multiplier)
```

**Ví dụ:** Member mua vé 1,200,000 VND:
- basePoints = floor(1,200,000 / 10,000) = 120
- pointsEarned = floor(120 × 1.0) = 120 điểm

**Ví dụ:** Platinum mua vé 1,200,000 VND:
- basePoints = 120
- pointsEarned = floor(120 × 1.75) = 210 điểm

---

## 4. ACTIONS — BUSINESS LOGIC

### 4.1 Earn Points (sau booking confirmed)

```
Flow:
  1. Lấy multiplier từ tier hiện tại
  2. Tính điểm = floor(price / 10000) × multiplier
  3. Cộng cả 3 cột trong 1 query
  4. Ghi transaction (type: 'earn')
  5. Check upgrade tier
```

**Idempotent:** Kiểm tra `loyalty_transactions` xem booking đã tích điểm chưa → nếu rồi thì bỏ qua.

---

### 4.2 Revoke Points (khi cancel/refund booking)

```
Flow:
  1. Tìm điểm đã earn từ booking này trong loyalty_transactions
  2. Trừ tier_points + current_points (KHÔNG trừ lifetime)
  3. Không để âm — trừ tối đa đến 0
  4. Ghi transaction (type: 'revoke')
  5. Check downgrade tier → notify nếu tụt hạng
```

---

### 4.3 Redeem Reward

```
Flow:
  1. Lock row (SELECT FOR UPDATE) → tránh race condition khi 2 request đổi đồng thời
  2. Kiểm tra reward tồn tại
  3. Kiểm tra đủ current_points từ locked row
  4. Sinh voucher code (format: VOUCHER-XXXXXXXX)
  5. Trừ current_points, RETURNING để lấy số chính xác
  6. Ghi transaction (type: 'redeem')

⚠️ lifetime_points và tier_points KHÔNG đổi → không tụt tier khi redeem
```

---

## 5. ANNUAL RESET CRON JOB

### 5.1 Thời gian chạy

```
Cron: "0 0 1 1 *" (00:00 ngày 1/1 theo GMT+7)
      = 17:00 UTC ngày 31/12
```

### 5.2 Logic

```
1. Lấy tất cả membership
2. Phạt 20% tier_points  (tier_points -= floor(tier_points × 0.20))
3. Recalculate tier theo tier_points mới
4. Nếu tier thay đổi → downgrade + notify
5. lifetime_points KHÔNG đổi
6. current_points  KHÔNG đổi
```

### 5.3 Ví dụ

| User | Tier | tier_points trước | Penalty | tier_points sau | Tier mới |
|------|------|-------------------|---------|-----------------|----------|
| A | Platinum | 55,000 | -11,000 | 44,000 | Gold |
| B | Gold | 25,000 | -5,000 | 20,000 | Gold |
| C | Silver | 6,000 | -1,200 | 4,800 | Member |

### 5.4 Notifications

| Tình huống | Type | Message |
|------------|------|---------|
| Downgrade tier | `tier_reset` | Thông báo điểm bị trừ, hạng thay đổi, kêu gọi tích lũy lại |
| Giữ nguyên tier | `points_reset` | Thông báo điểm bị trừ, hạng được giữ nguyên |

---

## 6. SYNC TIER LOGIC

```
Direction 'upgrade'   → chỉ lên tier, không xuống  (sau earn)
Direction 'downgrade' → chỉ xuống tier, không lên    (sau cancel/refund/cron)
Direction 'both'      → sync tuyệt đối               (dùng khi cần force sync)
```

---

## 7. DATABASE SCHEMA

### 7.1 Bảng `user_loyalty`

```sql
user_loyalty (
  id                  SERIAL PRIMARY KEY,
  user_id             BIGINT UNIQUE REFERENCES users(id),
  membership_number   VARCHAR(20) UNIQUE,   -- VD: VVD123456789
  tier_id             INT REFERENCES loyalty_tiers(id),
  lifetime_points     BIGINT NOT NULL DEFAULT 0,  -- chỉ cộng
  tier_points         BIGINT NOT NULL DEFAULT 0, -- xét tier + penalty
  current_points      BIGINT NOT NULL DEFAULT 0,  -- redeem được
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
)
```

### 7.2 Bảng `loyalty_tiers`

```sql
loyalty_tiers (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(20) UNIQUE,  -- Member, Silver, Gold, Platinum
  min_points  INT NOT NULL,
  multiplier  NUMERIC(4,2) NOT NULL,  -- 1.00, 1.25, 1.50, 1.75
  benefits    JSONB
)
```

### 7.3 Bảng `loyalty_transactions`

```sql
loyalty_transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  booking_id  BIGINT,               -- NULL khi redeem
  type        VARCHAR(20),           -- earn | revoke | redeem
  amount      BIGINT,               -- số điểm (+/-)
  description TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
)
```

### 7.4 Bảng `loyalty_rewards`

```sql
loyalty_rewards (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(100),
  description      TEXT,
  points_required  INT NOT NULL,
  discount_amount  NUMERIC(12,2),   -- số tiền được giảm
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT NOW()
)
```

### 7.5 Bảng `loyalty_notifications`

```sql
loyalty_notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  type        VARCHAR(50),          -- tier_reset | points_reset | tier_downgrade
  message     TEXT,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMP DEFAULT NOW()
)
```

---

## 8. API ENDPOINTS

### 8.1 Public / Optional Auth

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | `/api/loyalty/membership` | Optional | Lấy thông tin membership (theo token hoặc ?userId=) |
| GET | `/api/loyalty/rewards` | None | Danh sách reward có thể đổi |

### 8.2 Protected — Cần Auth

| Method | Endpoint | Body | Mô tả |
|--------|----------|------|-------|
| POST | `/api/loyalty/earn` | `{ bookingId, totalPrice }` | Tích điểm sau booking (idempotent) |
| POST | `/api/loyalty/revoke` | `{ bookingId }` | Revoke điểm khi huỷ booking |
| POST | `/api/loyalty/redeem` | `{ rewardId }` | Đổi điểm lấy reward |
| GET | `/api/loyalty/history` | query: `?page=0&limit=20` | Lịch sử giao dịch điểm |

### 8.3 Admin

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | `/api/loyalty/admin/trigger-annual-reset` | Admin only | Trigger annual reset thủ công |

### 8.4 Test Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/loyalty/test-earn?userId=8&totalPrice=1200000` | Tạo booking giả + tích điểm |
| GET | `/api/loyalty/test-redeem?userId=8&rewardId=1` | Test redeem reward |

---

## 9. FILE STRUCTURE

```
src/
├── services/loyalty.service.js    ← Business logic chính
├── queries/loyalty.queries.js    ← SQL queries
├── scripts/Loyalty.cron.js       ← Cron job annual reset
└── routes/loyalty.routes.js      ← API routes
```

---

## 10. INTEGRATION VỚI BOOKING SERVICE

Khi nào gọi các hàm loyalty:

```javascript
// 1. Sau khi booking confirmed → tích điểm
await loyaltyService.earnPointsAfterBooking(userId, bookingId, totalPrice);

// 2. Khi booking bị cancel hoặc refund → revoke điểm
await loyaltyService.revokePointsOnCancel(userId, bookingId);
```

---

## 11. EDGE CASES XỬ LÝ

| Trường hợp | Xử lý |
|-----------|--------|
| User chưa có membership | Tự động tạo mới với tier Member |
| Booking giá < 10,000 VND | Bỏ qua, không tích điểm (basePoints = 0) |
| Revoke nhiều hơn điểm hiện có | Chỉ trừ đến 0, không âm |
| 2 request redeem đồng thời | `SELECT FOR UPDATE` lock row → tránh race condition |
| Booking đã tích điểm rồi | `checkAlreadyEarned()` → bỏ qua, không tích trùng |
| Penalty khiến tier xuống thấp hơn | `resolveTier()` tự động recalculate tier |

---

## 12. MIGRATION

File migration: `src/migrations/009_create_loyalty_tables.sql`

Tạo đầy đủ:
- Bảng `loyalty_tiers` (4 hạng)
- Bảng `user_loyalty`
- Bảng `loyalty_transactions`
- Bảng `loyalty_rewards`
- Bảng `loyalty_notifications`

---

## 13. CRON JOB MANUAL TRIGGER

Để test cron job mà không cần chờ 00:00 ngày 1/1:

```bash
# Gọi API (cần token admin)
curl -X POST http://localhost:3000/api/loyalty/admin/trigger-annual-reset \
  -H "Authorization: Bearer <admin_token>"

# Hoặc chạy trực tiếp từ Node
node -e "require('./src/scripts/Loyalty.cron').runAnnualReset()"
```

---

## 14. TIER PROGRESSION TRACKING

Frontend có thể hiển thị progress bar cho user:

```javascript
// Response từ /api/loyalty/membership
{
  tier: "Silver",
  tier_points: 3500,
  next_tier: {
    name: "Gold",
    points_needed: 16500   // cần thêm bao nhiêu điểm để lên Gold
  },
  progress: 70   // 70% tiến đến Gold (chỉ hiện khi chưa max tier)
}
```

---

## 16. REFUND SYSTEM

### 16.1 Overview

Hệ thống hoàn tiền tích hợp với multiple payment gateways (PayPal, PayOS, MoMo).

### 16.2 Refund Flow

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  User       │────▶│  Pending    │────▶│  Approved    │────▶│  Processing   │
│  Request    │     │             │     │  (Admin)     │     │  (Admin)      │
└──────────────┘     └──────────────┘     └──────────────┘     └──────────────┘
                                                                    │
                              ┌─────────────────────────────────────┘
                              ▼
                     ┌──────────────┐     ┌──────────────┐
                     │ Payment      │────▶│  Completed   │
                     │ Gateway      │     │              │
                     └──────────────┘     └──────────────┘
```

### 16.3 Refund Types

| Type | Mô tả | Phí (Admin Fee) |
|------|--------|-----------------|
| `full` | Hoàn toàn | 0% |
| `partial` | Một phần | 10% của số tiền hoàn |

### 16.4 Refund Policies

| Policy | Điều kiện | Refund % |
|--------|-----------|----------|
| `free_cancellation` | Hủy trước 24h | 100% |
| `flight_cancelled` | Hãng hủy chuyến | 100% |
| `schedule_changed` | Đổi lịch trình | 100% |
| `no_show` | Không lên máy bay | 0% |
| `partial_refund` | Lý do khác | 90% |

### 16.5 Payment Gateway Integration

#### PayPal
- Gọi API `refundPayPalCapture()`
- Cập nhật `payments.status = 'REFUNDED'`
- Cập nhật `gateway_response` với refund result

#### PayOS
- Không hỗ trợ refund qua API
- Đánh dấu `refund_requested = true` trong `gateway_response`
- Admin cần xử lý thủ công

#### MoMo
- Không hỗ trợ refund qua API
- Đánh dấu `refund_requested = true` trong `gateway_response`
- Admin cần xử lý thủ công

### 16.6 API Endpoints

#### User Endpoints
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| POST | `/api/bookings/:bookingCode/refund` | Yêu cầu hoàn tiền |
| GET | `/api/bookings/:bookingCode/refunds` | Danh sách refunds |
| GET | `/api/refunds/my` | Lịch sử refund của tôi |
| GET | `/api/refunds/:refundCode` | Chi tiết refund |
| DELETE | `/api/refunds/:refundCode` | Hủy yêu cầu (pending/approved) |

#### Admin Endpoints
| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/admin/refunds` | Danh sách (filter) |
| GET | `/api/admin/refunds/pending` | Danh sách chờ duyệt |
| GET | `/api/admin/refunds/stats` | Thống kê |
| GET | `/api/admin/refunds/:refundCode` | Chi tiết |
| POST | `/api/admin/refunds/:refundCode/approve` | Duyệt |
| POST | `/api/admin/refunds/:refundCode/reject` | Từ chối |
| POST | `/api/admin/refunds/:refundCode/complete` | Hoàn thành (gọi gateway) |
| POST | `/api/admin/refunds/:refundCode/cancel` | Hủy refund |

### 16.7 File Structure

```
src/
├── services/refund.service.js     ← Business logic + reversePayment()
├── queries/refund.queries.js      ← SQL queries
├── controllers/
│   ├── refund.controller.js       ← User endpoints
│   └── admin/refund.controller.js  ← Admin endpoints
└── routes/
    ├── refund.routes.js           ← User routes
    └── admin.routes.js            ← Admin routes (A-08)
```

### 16.8 Reverse Payment Logic

```javascript
// Trong reversePayment(paymentId, amount)
// 1. Lấy payment từ DB để xác định gateway
// 2. Theo provider:
//    - PAYPAL: Gọi refundPayPalCapture() → API thật
//    - PAYOS: Đánh dấu refund_requested
//    - MOMO: Đánh dấu refund_requested
// 3. Cập nhật payments.status = 'REFUNDED'
// 4. Trả về kết quả
```

### 16.9 Integration với Loyalty

Khi refund completed:
- `revokePointsForRefund()` được gọi
- Trừ `tier_points` và `current_points`
- Không trừ `lifetime_points`
- Check tier downgrade nếu cần

### 16.10 Edge Cases

| Trường hợp | Xử lý |
|-----------|--------|
| Refund khi payment_id null | Bỏ qua gateway call, vẫn cập nhật refund status |
| Payment không tìm thấy | Log warning, return true để không block refund |
| Gateway call fail | Cập nhật status = 'failed', throw error |
| User hủy refund đang processing | Không cho phép, chỉ hủy pending/approved |
| Nhiều refund cho 1 booking | Chỉ cho phép 1 pending/approved/processing |

---

## 17. NOTES

- Tất cả điểm đều là số nguyên (dùng `floor()` để tránh số lẻ)
- `membership_number` format: `VVD` + 9 chữ số cuối của timestamp
- Voucher code format: `VOUCHER-XXXXXXXX` (8 ký tự hex ngẫu nhiên)
- Cron job có `ROLLBACK` nếu lỗi → đảm bảo tính atomic
- Refund code format: `REF` + random số
- Payment gateway refund chỉ gọi khi admin complete refund
