# MEMBERSHIP & REFUND SYSTEM

---

## PHẦN 1: MEMBERSHIP / LOYALTY SYSTEM

### 1.1 Tổng Quan

Hệ thống tích điểm và thăng hạng cho khách hàng. Mỗi lần booking, user được cộng điểm dựa trên số tiền thanh toán và hạng thành viên hiện tại.

---

### 1.2 Kiến Trúc 3 Cột Điểm

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         3 CỘT ĐIỂM - VAI TRÒ RIÊNG BIỆT              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐     │
│  │  lifetime_points │  │   tier_points    │  │  current_points  │     │
│  ├──────────────────┤  ├──────────────────┤  ├──────────────────┤     │
│  │ • CHỈ CỘNG       │  │ • Cộng khi earn │  │ • Cộng khi earn │     │
│  │ • KHÔNG BAO GIỜ  │  │ • Trừ khi       │  │ • Trừ khi       │     │
│  │   GIẢM           │  │   cancel/refund  │  │   cancel/refund  │     │
│  │                  │  │ • Trừ khi cron   │  │ • Trừ khi redeem│     │
│  │ • Dùng cho       │  │   annual reset   │  │                 │     │
│  │   báo cáo, lịch  │  │                  │  │ • Điểm user     │     │
│  │   sửử vĩnh viễn │  │ • Dùng xét tier │  │   DÙNG ĐƯỢC    │     │
│  │                  │  │ • Cron penalty   │  │   để đổi reward│     │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘     │
│                                                                         │
│  ═══════════════════════════════════════════════════════════════════   │
│  ACTION              │  lifetime  │  tier  │  current                  │
│  ───────────────────┼───────────┼────────┼─────────                   │
│  Earn (booking)      │    +      │   +    │    +                      │
│  Redeem reward       │    —      │   —    │    -                      │
│  Cancel / refund     │    —      │   -    │    -     → check downgrade│
│  Cron annual reset   │    —      │   -20% │    —     → check downgrade│
│  ═══════════════════════════════════════════════════════════════════ │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 1.3 Hệ Thống Tiers (Hạng Thành Viên)

```
                    ┌─────────────────────────────────────────────────┐
                    │           TIER PROGRESSION (Thăng Hạng)        │
                    └─────────────────────────────────────────────────┘

    Member (0)  ────────────────────────────────▶  Silver (5,000)  ────────────────────────────────▶  Gold (20,000)  ────────────────────────────────▶  Platinum (50,000)
    ×1.0                                                      ×1.25                                                   ×1.5                                                    ×1.75

    "Tích điểm        "Tích nhanh hơn       "Tích nhanh hơn      "Tích nhanh hơn
     không giới hạn"   25%, ưu đãi 7%"       50%, ưu đãi 10%     75%, ưu đãi 15%,
                                                                   hành lý miễn phí
                                                                   10kg, phòng chờ VIP"

┌─────────────────────────────────────────────────────────────────────────┐
│                          TIER CONFIGURATION                             │
├────────────┬───────────────┬──────────────┬────────────────────────────────┤
│   Tier     │  Min Points   │  Multiplier  │  Benefits (Sample)             │
├────────────┼───────────────┼──────────────┼────────────────────────────────┤
│ Member     │  0            │  ×1.0        │  Tích điểm không giới hạn     │
│            │               │              │  Ưu đãi 5% chuyến bay tiếp    │
├────────────┼───────────────┼──────────────┼────────────────────────────────┤
│ Silver     │  5,000        │  ×1.25       │  Nhân 1.25x điểm              │
│            │               │              │  Ưu đãi 7% chuyến bay         │
│            │               │              │  Hoàn vé ưu đãi hơn           │
├────────────┼───────────────┼──────────────┼────────────────────────────────┤
│ Gold       │  20,000       │  ×1.5        │  Nhân 1.5x điểm               │
│            │               │              │  Ưu đãi 10% chuyến bay        │
│            │               │              │  Hành lý miễn phí 10kg        │
│            │               │              │  Đổi vé miễn phí 1 lần/năm    │
├────────────┼───────────────┼──────────────┼────────────────────────────────┤
│ Platinum   │  50,000       │  ×1.75       │  Nhân 1.75x điểm              │
│            │               │              │  Ưu đãi 15% chuyến bay        │
│            │               │              │  Hành lý miễn phí 20kg        │
│            │               │              │  Phòng chờ VIP miễn phí       │
│            │               │              │  Nâng hạng ghế miễn phí       │
└────────────┴───────────────┴──────────────┴────────────────────────────────┘
```

---

### 1.4 Công Thức Tính Điểm

```javascript
// Công thức tính điểm khi earn
basePoints   = Math.floor(totalPrice / 10,000)
pointsEarned = Math.floor(basePoints × multiplier)

// Ví dụ 1: Member mua vé 1,200,000 VND
// basePoints = floor(1,200,000 / 10,000) = 120
// pointsEarned = floor(120 × 1.0) = 120 điểm
// → Cộng: lifetime +120, tier +120, current +120

// Ví dụ 2: Platinum mua vé 1,200,000 VND
// basePoints = 120
// pointsEarned = floor(120 × 1.75) = 210 điểm
// → Cộng: lifetime +210, tier +210, current +210
```

---

### 1.5 Chi Tiết Các Actions

#### 1.5.1 EARN POINTS (Sau Booking Confirmed)

```
┌─────────────────────────────────────────────────────────────────┐
│                    EARN POINTS FLOW                             │
└─────────────────────────────────────────────────────────────────┘

  User Bookings              Loyalty Service                    Database
      │                           │                                 │
      ▼                           ▼                                 │
  ┌────────┐                ┌─────────────────┐            ┌──────────────┐
  │ 1. Get │───────────────▶│ Lấy multiplier  │───────────▶│ user_loyalty │
  │ booking│                │ từ tier hiện tại│            │   (tier_id)  │
  │ confirmed              └─────────────────┘            └──────────────┘
  │                                 │
      │                           ▼
      │                    ┌─────────────────┐
      │                    │ Tính điểm:     │
      │                    │ base × multiplier│
      │                    └─────────────────┘
      │                                 │
      ▼                           ▼                                 │
  ┌────────┐                ┌─────────────────┐            ┌──────────────┐
  │Check   │◀──────────────│ Đã tích điểm   │───────────▶│ loyalty_     │
  │already │                │ cho booking này?│            │ transactions │
  │earned? │                └─────────────────┘            │ (type:earn)  │
  └────────┘                                                 └──────────────┘
      │                                 │
      │ Yes                             ▼
      │ (Skip)                  ┌─────────────────┐
      │                         │ Check upgrade:   │
      │                         │ tier_points mới  │
      │                         │ → new tier?      │
      │                         └─────────────────┘
      │                                   │
      ▼                                   ▼
  ┌────────┐                      ┌─────────────────┐
  │  Done  │◀─────────────────────│ Update tier_id  │
  └────────┘                      │ nếu cần thiết   │
                                 └─────────────────┘

Idempotent: Kiểm tra loyalty_transactions xem booking đã tích điểm chưa
```

#### 1.5.2 REVOKE POINTS (Khi Cancel/Refund)

```
┌─────────────────────────────────────────────────────────────────┐
│                    REVOKE POINTS FLOW                           │
└─────────────────────────────────────────────────────────────────┘

  Booking Cancelled          Loyalty Service                    Database
      │                           │                                 │
      ▼                           ▼                                 │
  ┌──────────┐              ┌─────────────────┐            ┌──────────────┐
  │ Status:  │─────────────▶│ Tìm điểm đã    │───────────▶│ loyalty_     │
  │ cancelled│              │ earn từ booking │            │ transactions │
  │ hoặc     │              └─────────────────┘            │ (type:earn)  │
  │ refunded │                        │                       └──────────────┘
  └──────────┘                        │
      │                               ▼
      │                        ┌─────────────────┐
      │                        │ Lấy điểm hiện  │
      │                        │ có để tính safe │
      │                        │ revoke          │
      │                        └─────────────────┘
      │                               │
      ▼                               ▼
  ┌──────────┐              ┌─────────────────┐            ┌──────────────┐
  │Gọi hàm  │─────────────▶│ Trừ tier_points │───────────▶│ user_loyalty │
  │revoke    │              │ + current_points│            │              │
  │Points    │              │ (không trừ      │            │              │
  │OnCancel  │              │  lifetime)       │            │              │
  └──────────┘              │ Không âm (min 0)│            │              │
                            └─────────────────┘            └──────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐            ┌──────────────┐
                            │ Ghi transaction │───────────▶│ loyalty_     │
                            │ (type: revoke)  │            │ transactions │
                            └─────────────────┘            │ (type:revoke)│
                                    │                       └──────────────┘
                                    ▼
                            ┌─────────────────┐
                            │ Check downgrade │
                            │ tier_points mới │
                            │ → new tier?     │
                            └─────────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │ Notify user nếu │
                            │ tụt hạng       │
                            └─────────────────┘
```

#### 1.5.3 REDEEM REWARD

```
┌─────────────────────────────────────────────────────────────────┐
│                    REDEEM REWARD FLOW                           │
└─────────────────────────────────────────────────────────────────┘

  User Request            Loyalty Service                    Database
      │                           │                                 │
      ▼                           ▼                                 │
  ┌──────────┐              ┌─────────────────┐            ┌──────────────┐
  │ 1. User  │─────────────▶│ SELECT FOR      │───────────▶│ user_loyalty │
  │  chọn   │              │ UPDATE (lock    │            │   FOR UPDATE │
  │  reward │              │ row)            │            │              │
  └──────────┘              └─────────────────┘            └──────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │ Kiểm tra đủ    │
                            │ current_points?│
                            └─────────────────┘
                                    │
                           ┌────────┴────────┐
                           │                 │
                          Yes               No
                           │                 │
                           ▼                 ▼
                    ┌─────────────┐    ┌─────────────┐
                    │ Tiếp tục   │    │ Throw error │
                    └─────────────┘    │ "Không đủ   │
                           │          │  điểm"      │
                           ▼          └─────────────┘
                    ┌─────────────────┐
                    │ Sinh voucher:  │
                    │ VOUCHER-XXXXXX │
                    └─────────────────┘
                           │
                           ▼
                    ┌─────────────────┐            ┌──────────────┐
                    │ Trừ             │───────────▶│ user_loyalty │
                    │ current_points  │            │ current -N   │
                    │ (RETURNING)     │            │              │
                    └─────────────────┘            └──────────────┘
                           │
                           ▼
                    ┌─────────────────┐            ┌──────────────┐
                    │ Ghi transaction │───────────▶│ loyalty_     │
                    │ (type: redeem)  │            │ transactions │
                    └─────────────────┘            │ (type:redeem)│
                                                  └──────────────┘

⚠️ LƯU Ý QUAN TRỌNG:
- lifetime_points: KHÔNG ĐỔI → không tụt tier khi redeem
- tier_points: KHÔNG ĐỔI → không tụt tier khi redeem
- Chỉ current_points giảm
```

---

### 1.6 Annual Reset Cron Job

```
┌─────────────────────────────────────────────────────────────────┐
│              ANNUAL RESET CRON JOB (Ngày 1/1 hàng năm)         │
└─────────────────────────────────────────────────────────────────┘

  Cron Trigger                  Logic                         Database
      │                           │                                 │
      ▼                           ▼                                 │
  ┌──────────┐              ┌─────────────────┐            ┌──────────────┐
  │ 00:00    │─────────────▶│ Lấy tất cả     │───────────▶│ user_loyalty │
  │ 1/1/GMT+7│              │ membership      │            │              │
  └──────────┘              └─────────────────┘            └──────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │ Với mỗi user:  │
                            │ tier_points -=  │
                            │ floor(pts×0.20)│
                            │ lifetime: KHÔNG  │
                            │ current: KHÔNG  │
                            └─────────────────┘
                                    │
                                    ▼
                            ┌─────────────────┐
                            │ Recalculate     │
                            │ tier theo       │
                            │ tier_points mới │
                            └─────────────────┘
                                    │
                           ┌────────┴────────┐
                           │                 │
                          Downgrade        Same/Upgrade
                           │                 │
                           ▼                 ▼
                    ┌─────────────┐    ┌─────────────┐
                    │ Notify user│    │ No notify   │
                    │ type:      │    │             │
                    │ tier_reset │    │             │
                    └─────────────┘    └─────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    VÍ DỤ ANNUAL RESET                           │
├──────────────────┬────────────┬───────────┬────────────┬────────┤
│ User             │ Tier      │ Trước     │ Penalty    │ Sau    │
├──────────────────┼────────────┼───────────┼────────────┼────────┤
│ A (Platinum)     │ Platinum   │ 55,000    │ -11,000    │ 44,000 │ → Gold
│ B (Gold)         │ Gold       │ 25,000    │ -5,000     │ 20,000 │ → Gold (giữ)
│ C (Silver)       │ Silver     │ 6,000     │ -1,200     │ 4,800  │ → Member
│ D (Member)       │ Member     │ 2,000     │ -400       │ 1,600  │ → Member (giữ)
└──────────────────┴────────────┴───────────┴────────────┴────────┘
```

---

### 1.7 Database Schema

```sql
-- Bảng 1: user_loyalty (Thông tin membership của user)
CREATE TABLE user_loyalty (
  id                  BIGSERIAL PRIMARY KEY,
  user_id             BIGINT UNIQUE REFERENCES users(id),
  membership_number   VARCHAR(20) UNIQUE,  -- Format: VVD + 9 chữ số (VD: VVD123456789)
  tier_id             BIGINT REFERENCES loyalty_tiers(id),
  
  -- 3 CỘT ĐIỂM
  lifetime_points     BIGINT NOT NULL DEFAULT 0,  -- CHỈ CỘNG, không giảm
  tier_points         BIGINT NOT NULL DEFAULT 0,  -- Xét tier + cron penalty
  current_points      BIGINT NOT NULL DEFAULT 0,  -- Redeem được
  
  created_at          TIMESTAMP DEFAULT NOW(),
  updated_at          TIMESTAMP DEFAULT NOW()
);

-- Bảng 2: loyalty_tiers (4 hạng thành viên)
CREATE TABLE loyalty_tiers (
  id          BIGSERIAL PRIMARY KEY,
  name        VARCHAR(20) UNIQUE,  -- Member, Silver, Gold, Platinum
  min_points  INT NOT NULL,        -- 0, 5000, 20000, 50000
  multiplier  NUMERIC(4,2) NOT NULL,  -- 1.00, 1.25, 1.50, 1.75
  benefits    JSONB  -- ["Ưu đãi 5%...", "Tích điểm..."]
);

-- Bảng 3: loyalty_transactions (Lịch sử giao dịch điểm)
CREATE TABLE loyalty_transactions (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  booking_id  BIGINT,  -- NULL khi redeem
  type        VARCHAR(20),  -- 'earn' | 'revoke' | 'redeem'
  amount      BIGINT,  -- Số điểm (+/-)
  description TEXT,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Bảng 4: loyalty_rewards (Danh sách reward có thể đổi)
CREATE TABLE loyalty_rewards (
  id               BIGSERIAL PRIMARY KEY,
  name             VARCHAR(100),
  description      TEXT,
  points_required  INT NOT NULL,
  discount_amount  NUMERIC(12,2),  -- Số tiền được giảm
  is_active        BOOLEAN DEFAULT true,
  created_at       TIMESTAMP DEFAULT NOW()
);

-- Bảng 5: loyalty_notifications (Thông báo cho user)
CREATE TABLE loyalty_notifications (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id),
  type        VARCHAR(50),  -- tier_upgrade | tier_downgrade | tier_reset | points_reset | earn | redeem
  message     TEXT,
  is_read     BOOLEAN DEFAULT false,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_loyalty_transactions_user_id ON loyalty_transactions(user_id);
CREATE INDEX idx_loyalty_transactions_type ON loyalty_transactions(type);
CREATE INDEX idx_loyalty_notifications_user_id ON loyalty_notifications(user_id);
```

---

### 1.8 API Endpoints

#### 1.8.1 Public / Optional Auth

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| GET | `/api/loyalty/membership` | Optional | Lấy thông tin membership (theo token hoặc `?userId=`) |
| GET | `/api/loyalty/rewards` | None | Danh sách reward có thể đổi |

#### 1.8.2 Protected - Cần Auth

| Method | Endpoint | Body | Mô tả |
|--------|----------|------|-------|
| POST | `/api/loyalty/earn` | `{ bookingId, totalPrice }` | Tích điểm sau booking (idempotent) |
| POST | `/api/loyalty/revoke` | `{ bookingId }` | Revoke điểm khi huỷ booking |
| POST | `/api/loyalty/redeem` | `{ rewardId }` | Đổi điểm lấy reward |
| GET | `/api/loyalty/history` | query: `?page=0&limit=20` | Lịch sử giao dịch điểm |

#### 1.8.3 Admin

| Method | Endpoint | Auth | Mô tả |
|--------|----------|------|-------|
| POST | `/api/loyalty/admin/trigger-annual-reset` | Admin only | Trigger annual reset thủ công |

#### 1.8.4 Test Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/api/loyalty/test-earn?userId=8&totalPrice=1200000` | Tạo booking giả + tích điểm |
| GET | `/api/loyalty/test-redeem?userId=8&rewardId=1` | Test redeem reward |

---

### 1.9 File Structure

```
src/
├── services/loyalty.service.js    ← Business logic chính (earn, revoke, redeem)
├── queries/loyalty.queries.js      ← SQL queries
├── scripts/Loyalty.cron.js        ← Cron job annual reset
└── routes/loyalty.routes.js       ← API routes
```

---

### 1.10 Integration Với Booking Service

```javascript
// 1. Sau khi booking confirmed → tích điểm
await loyaltyService.earnPointsAfterBooking(userId, bookingId, totalPrice);

// 2. Khi booking bị cancel → revoke điểm (không refund)
await loyaltyService.revokePointsOnCancel(userId, bookingId);

// 3. Khi refund completed → revoke điểm (refund thực sự)
await loyaltyService.revokePointsForRefund(bookingId, userId, refundType, refundPercent);
```

---

### 1.11 Edge Cases

| Trường hợp | Xử lý |
|-----------|--------|
| User chưa có membership | Tự động tạo mới với tier Member |
| Booking giá < 10,000 VND | Bỏ qua, không tích điểm (basePoints = 0) |
| Revoke nhiều hơn điểm hiện có | Chỉ trừ đến 0, không âm |
| 2 request redeem đồng thời | `SELECT FOR UPDATE` lock row → tránh race condition |
| Booking đã tích điểm rồi | `checkAlreadyEarned()` → bỏ qua, không tích trùng |
| Penalty khiến tier xuống thấp hơn | `resolveTier()` tự động recalculate tier |

---

### 1.12 Rewards Seeds

| Reward | Points Required | Discount Amount | Description |
|--------|----------------|-----------------|-------------|
| Voucher 50.000 VND | 1,000 | 50,000 | Giảm 50.000 VND cho đơn hàng tiếp theo |
| Voucher 100.000 VND | 1,800 | 100,000 | Giảm 100.000 VND cho đơn hàng tiếp theo |
| Voucher 200.000 VND | 3,500 | 200,000 | Giảm 200.000 VND cho đơn hàng tiếp theo |
| Voucher 500.000 VND | 8,000 | 500,000 | Giảm 500.000 VND cho đơn hàng tiếp theo |
| Nâng hạng ghế Business | 5,000 | 0 | Nâng cấp lên ghế Business cho 1 chuyến bay |
| Phòng chờ VIP 1 lần | 3,000 | 0 | Miễn phí vào phòng chờ hạng thương gia |

---

## PHẦN 2: REFUND SYSTEM

### 2.1 Tổng Quan

Hệ thống hoàn tiền tích hợp với time-based policies và multiple payment gateways (PayPal, PayOS, MoMo).

---

### 2.2 Refund Flow (Mermaid)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REFUND FLOW - FULL LIFECYCLE                        │
└─────────────────────────────────────────────────────────────────────────┘

     USER                          SYSTEM                       ADMIN
      │                               │                           │
      ▼                               ▼                           │
  ┌──────────┐              ┌─────────────────┐                 │
  │ 1. User  │─────────────▶│ Validate booking │                │
  │  yêu cầu │              │ - Status confirmed │            │
  │  refund   │              │ - Chưa khởi hành │              │
  └──────────┘              └─────────────────┘                │
      │                            │                             │
      │                            ▼                             │
      │                   ┌─────────────────┐                    │
      │                   │ Check policy:   │                    │
      │                   │ Hours before    │                    │
      │                   │ departure       │                    │
      │                   └─────────────────┘                    │
      │                            │                             │
      │                            ▼                             │
      │                   ┌─────────────────┐                    │
      │                   │ Calculate refund │                   │
      │                   │ amount + fee    │                   │
      │                   └─────────────────┘                    │
      │                            │                             │
      ▼                            ▼                             │
  ┌──────────┐              ┌─────────────────┐                    │
  │ Nhận mã │◀─────────────│ Tạo refund req  │                    │
  │ REF-XXX │              │ Status: pending │                    │
  └──────────┘              └─────────────────┘                    │
                                    │                               │
                                    │ Notify user + admin          │
                                    ▼                               │
                                    │                    ┌──────────────┐
                                    │                    │ 2. Admin xem │
                                    │                    │  danh sách   │
                                    │                    └──────────────┘
                                    │                               │
                                    │                    ┌──────────────┐
                                    │◀───────────────────│ 3. Approve   │
                                    │                    │ hoặc Reject  │
                                    │                    └──────────────┘
                                    │                               │
                           ┌────────┴────────┐                       │
                          Approve         Reject                    │
                           │               │                        │
                           ▼               ▼                        │
                    ┌─────────────┐  ┌─────────────┐               │
                    │ Status:     │  │ Status:     │               │
                    │ approved    │  │ rejected    │               │
                    │ Booking:    │  │ Booking:    │               │
                    │ refund_pending│  │ confirmed   │               │
                    └─────────────┘  └─────────────┘               │
                           │                                       │
                           ▼                                       │
                    ┌─────────────┐                                │
                    │ 4. Process │                                │
                    │ (Admin)    │                                │
                    └─────────────┘                                │
                           │                                       │
                           ▼                                       │
                    ┌─────────────┐                                │
                    │ Call Payment│                                │
                    │ Gateway API │                                │
                    └─────────────┘                                │
                           │                                       │
                  ┌────────┴────────┐                              │
                 Success          Failed                           │
                  │               │                                │
                  ▼               ▼                                │
           ┌─────────────┐  ┌─────────────┐                        │
           │ Status:     │  │ Status:     │                        │
           │ processing  │  │ failed      │                        │
           └─────────────┘  └─────────────┘                        │
                  │                                                  │
                  ▼                                                  │
           ┌─────────────┐                                          │
           │ Complete:   │                                          │
           │ - Refund OK │                                          │
           │ - Booking:  │                                          │
           │   refunded  │                                          │
           │ - Revoke    │                                          │
           │   loyalty   │                                          │
           │   points    │                                          │
           └─────────────┘                                          │
                  │                                                  │
                  ▼                                                  │
           ┌─────────────┐                                          │
           │ Notify user │                                          │
           └─────────────┘                                          │
```

---

### 2.3 Time-Based Refund Policies

```
┌─────────────────────────────────────────────────────────────────────────┐
│              TIME-BASED REFUND POLICIES                                │
│              (Tính theo giờ trước giờ khởi hành)                     │
└─────────────────────────────────────────────────────────────────────────┘

  Giờ khởi hành
       │
       │◀──────────── 72 tiếng ──────────────▶│
       │                                        │
       ▼                                        ▼
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                    HOÀN 100%                                 │   │
│   │   Policy: full_refund                                         │   │
│   │   Label: "Hoàn 100% - Yêu cầu trước 72 tiếng"              │   │
│   │   Condition: > 72 tiếng trước giờ bay                        │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   │◀────────────────── 24 tiếng ──────────────────▶│              │
│   │                                            │                  │
│   ▼                                            ▼                  │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │                    HOÀN 80%                                  │   │
│ │   Policy: high_refund                                        │   │
│ │   Label: "Hoàn 80% - Yêu cầu trong 24-72 tiếng"            │   │
│ │   Condition: 24 - 72 tiếng trước giờ bay                    │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   │◀────────────────── 12 tiếng ──────────────────▶│              │
│   │                                            │                  │
│   ▼                                            ▼                  │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │                    HOÀN 50%                                  │   │
│ │   Policy: medium_refund                                      │   │
│ │   Label: "Hoàn 50% - Yêu cầu trong 12-24 tiếng"            │   │
│ │   Condition: 12 - 24 tiếng trước giờ bay                     │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│   │◀─────────────────────▶│                                      │
│   ▼                       ▼                                       │
│ ┌──────────────────────────────────────────────────────────────┐   │
│ │                    KHÔNG HOÀN (0%)                           │   │
│ │   Policy: low_refund                                         │   │
│ │   Label: "Không hoàn - Yêu cầu dưới 12 tiếng"               │   │
│ │   Condition: < 12 tiếng trước giờ bay                        │   │
│ └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

### 2.4 Refund Types

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         REFUND TYPES                                   │
└─────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  TYPE: full                                                          │
│  ───────────────────────────────────────────────────────────────────│
│  Mô tả: Hoàn tiền toàn bộ booking                                   │
│  Admin Fee: 0% (Miễn phí)                                            │
│  Logic: refund_amount = base_amount × refund_percent                   │
│                                                                     │
│  Ví dụ: Booking 1,000,000 VND, >72h trước bay                        │
│  → Hoàn: 1,000,000 × 100% = 1,000,000 VND                           │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  TYPE: partial_leg                                                   │
│  ───────────────────────────────────────────────────────────────────│
│  Mô tả: Hoàn tiền cho 1 leg (chuyến đi hoặc chuyến về)              │
│  Admin Fee: 0% (Miễn phí)                                            │
│  Logic: refund_amount = (base_amount / 2) × refund_percent            │
│                                                                     │
│  requested_items: { "legs": ["outbound"] }  ← Chỉ hoàn chuyến đi    │
│  requested_items: { "legs": ["return"] }   ← Chỉ hoàn chuyến về    │
│  requested_items: { "legs": ["outbound", "return"] } ← Hoàn cả 2    │
│                                                                     │
│  Ví dụ: Round-trip 2,000,000 VND, >72h                              │
│  → Hoàn 1 leg: (2,000,000 / 2) × 100% = 1,000,000 VND              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  TYPE: partial_passenger                                             │
│  ───────────────────────────────────────────────────────────────────│
│  Mô tả: Hoàn tiền cho 1 số hành khách                               │
│  Admin Fee: 0% (Miễn phí)                                            │
│  Logic: refund = (base_amount × passengers/total) × refund_percent   │
│                                                                     │
│  requested_items: { "passenger_ids": [1, 2] }                       │
│                                                                     │
│  Ví dụ: Booking 3 người, 1,500,000 VND (500k/person), >72h          │
│  → Hoàn 2 người: (1,500,000 × 2/3) × 100% = 1,000,000 VND          │
└─────────────────────────────────────────────────────────────────────┘
```

---

### 2.5 Refund Calculation Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  REFUND AMOUNT CALCULATION                            │
└─────────────────────────────────────────────────────────────────────────┘

  Input                                      Process                        Output
  ─────                                      ───────                        ──────

┌─────────────┐                      ┌─────────────────┐            ┌─────────────────┐
│ booking     │                      │ 1. Determine    │            │ base_amount     │
│ payment     │─────────────────────▶│ base_amount     │───────────▶│ = final_amount  │
│             │                      │ (final_amount   │            │ hoặc amount     │
│             │                      │  nếu có voucher)│            │ tùy config      │
└─────────────┘                      └─────────────────┘            └─────────────────┘
                                                                        │
                                            │                            │
                                            ▼                            ▼
                                   ┌─────────────────┐          ┌─────────────────┐
                                   │ 2. Find policy  │          │ refund_percent   │
                                   │ by hours before │─────────▶│ = policy %      │
                                   │ departure       │          │ (100/80/50/0)   │
                                   └─────────────────┘          └─────────────────┘
                                                                        │
                                            │                            │
                                            ▼                            ▼
                                   ┌─────────────────┐          ┌─────────────────┐
                                   │ 3. Calculate    │          │ refund_amount   │
                                   │ by refund_type  │─────────▶│ = base × %     │
                                   │ (full/partial)  │          │                 │
                                   └─────────────────┘          └─────────────────┘
                                                                        │
                                            │                            │
                                            ▼                            ▼
                                   ┌─────────────────┐          ┌─────────────────┐
                                   │ 4. Calculate    │          │ admin_fee       │
                                   │ admin_fee       │─────────▶│ = refund × 0%   │
                                   │ (0% - Miễn phí)  │          │ (hiện tại = 0)  │
                                   └─────────────────┘          └─────────────────┘
                                                                        │
                                            │                            │
                                            ▼                            ▼
                                   ┌─────────────────┐          ┌─────────────────┐
                                   │ 5. Calculate    │          │ net_refund      │
                                   │ net_refund      │─────────▶│ = refund - fee  │
                                   │                 │          │                 │
                                   └─────────────────┘          └─────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                           VÍ DỤ TÍNH TOÁN                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  Booking: 1,500,000 VND (đã dùng voucher 100k, trả 1,400,000 VND)     │
│  Thời gian yêu cầu: 50 tiếng trước giờ bay (→ high_refund: 80%)      │
│  refundOnFinalAmount: true (config)                                    │
│                                                                         │
│  Step 1: base_amount = final_amount = 1,400,000                        │
│  Step 2: refund_percent = 80%                                          │
│  Step 3: refund_amount = 1,400,000 × 80% = 1,120,000                 │
│  Step 4: admin_fee = 0 (0%)                                           │
│  Step 5: net_refund = 1,120,000 - 0 = 1,120,000                      │
│                                                                         │
│  Kết quả: User nhận lại 1,120,000 VND                                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2.6 Refund Status Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REFUND STATUS LIFECYCLE                            │
└─────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────────────────────────┐
                    │                                     │
                    │           ┌──────────┐              │
    User Request ──▶│           │ pending  │◀─── User yêu cầu
                    │           └────┬─────┘
                    │                │
                    │    ┌───────────┴───────────┐
                    │    │                       │
                    │    ▼                       ▼
                    │ ┌──────────┐          ┌──────────┐
                    │ │ rejected │          │ approved │
                    │ │ (Admin)  │          │ (Admin)  │
                    │ └──────────┘          └────┬─────┘
                    │                            │
                    │                            ▼
                    │                     ┌──────────┐
                    │                     │processing│
                    │                     │ (Admin)  │
                    │                     └────┬─────┘
                    │                          │
                    │           ┌───────────────┴───────────────┐
                    │           │                               │
                    │           ▼                               ▼
                    │    ┌────────────┐                  ┌───────────┐
                    │    │ completed  │                  │  failed   │
                    │    │            │                  │           │
                    │    │ - Hoàn OK  │                  │ - Gateway │
                    │    │ - Booking  │                  │   error   │
                    │    │   refunded │                  └───────────┘
                    │    │ - Revoke   │                          │
                    │    │   loyalty  │                          │
                    │    └────────────┘                          │
                    │           │                               │
                    │           │              ┌─────────────────┘
                    │           │              │
                    │           ▼              ▼
                    │    ┌──────────────────────────┐
                    │    │        cancelled         │
                    │    │ (User/Admin hủy request) │
                    │    │ Chỉ cancel khi:         │
                    │    │ - pending               │
                    │    │ - approved              │
                    │    └──────────────────────────┘
                    │           │
                    └───────────┴────────────────────────────

┌─────────────────────────────────────────────────────────────────────────┐
│                         STATUS PROPERTIES                               │
├─────────────────┬────────────┬─────────────────────────────────────────┤
│ Status          │ Color      │ Next Actions                             │
├─────────────────┼────────────┼─────────────────────────────────────────┤
│ pending         │ warning    │ [approve, reject]                        │
│ approved        │ info      │ [complete, cancel]                      │
│ rejected        │ danger    │ (terminal)                               │
│ processing      │ info      │ [complete, fail]                        │
│ completed       │ success   │ (terminal)                              │
│ cancelled       │ secondary │ (terminal)                              │
│ failed          │ danger    │ [retry, cancel]                         │
└─────────────────┴────────────┴─────────────────────────────────────────┘
```

---

### 2.7 Payment Gateway Integration

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    PAYMENT GATEWAY INTEGRATION                         │
└─────────────────────────────────────────────────────────────────────────┘

                              ┌─────────────────┐
                              │  reversePayment │
                              │    (paymentId,  │
                              │     amount)     │
                              └────────┬────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
           ┌────────────────┐ ┌────────────────┐ ┌────────────────┐
           │    PAYPAL      │ │     PAYOS      │ │     MOMO       │
           ├────────────────┤ ├────────────────┤ ├────────────────┤
           │ API:           │ │ API:           │ │ API:           │
           │ refundPayPal   │ │ Không hỗ trợ   │ │ Không hỗ trợ   │
           │ Capture()      │ │ refund qua API │ │ refund qua API │
           ├────────────────┤ ├────────────────┤ ├────────────────┤
           │ Flow:          │ │ Flow:          │ │ Flow:          │
           │ 1. Gọi API    │ │ 1. Đánh dấu    │ │ 1. Đánh dấu    │
           │    PayPal      │ │    refund_req  │ │    refund_req  │
           │ 2. Update DB   │ │ 2. Admin xử lý │ │ 2. Admin xử lý │
           │    REFUNDED    │ │    thủ công    │ │    thủ công    │
           │ 3. Return OK   │ │ 3. Update DB   │ │ 3. Update DB   │
           └────────────────┘ └────────────────┘ └────────────────┘
                                       │                  │
                                       └────────┬─────────┘
                                                │
                                                ▼
                                       ┌────────────────┐
                                       │   BANK_QR /    │
                                       │   OTHER        │
                                       ├────────────────┤
                                       │ Update trực tiếp│
                                       │ payments.status │
                                       │ = 'REFUNDED'   │
                                       └────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    GATEWAY RESPONSE STORAGE                            │
└─────────────────────────────────────────────────────────────────────────┘

payments.gateway_response (JSONB):
{
  "provider": "PAYPAL",
  "capture_id": "xxx-xxx-xxx",
  "order_id": "...",
  
  // Khi refund thành công:
  "refund_result": {
    "status": "COMPLETED",
    "refund_id": "ref-xxx"
  },
  
  // Khi refund fail:
  "refund_error": "Gateway timeout"
}

{
  "provider": "PAYOS",
  "order_code": 12345678,
  
  // Khi yêu cầu refund:
  "refund_requested": true,
  "refund_amount": 1000000,
  "requested_at": "2026-05-22T..."
}
```

---

### 2.8 Guest Refund Support

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    GUEST REFUND FLOW                                   │
└─────────────────────────────────────────────────────────────────────────┘

  Guest (không cần đăng nhập)              System                       Database
       │                                      │                             │
       ▼                                      ▼                             │
  ┌──────────┐                        ┌─────────────────┐          ┌──────────────┐
  │ 1. Guest │───────────────────────▶│ Verify booking  │─────────▶│ bookings     │
  │  gửi    │                        │ bằng booking    │          │ (check email)│
  │  refund  │                        │ code + email    │          └──────────────┘
  │  request │                        └─────────────────┘
  │          │                                 │
  │          │                                 ▼
  │          │                        ┌─────────────────┐
  │          │                        │ Validate:       │
  │          │                        │ - Email khớp    │
  │          │                        │ - Chưa refund   │
  │          │                        └─────────────────┘
  │          │                                 │
  │          │                                 ▼
  │          │                        ┌─────────────────┐
  │          │                        │ Tạo refund:     │
  │          │                        │ - is_guest=true  │
  │          │                        │ - guest_email=..│
  │          │                        │ - requested_by=null│
  │          │                        └─────────────────┘
  │          │                                 │
  └──────────┘                                 ▼
                                              │          ┌──────────────┐
                                              │◀─────────│ refunds      │
                                              │          │ (is_guest)   │
                                              │          └──────────────┘
                                              │
                                              ▼
                                       ┌─────────────────┐
                                       │ Gửi email xác   │
                                       │ nhận cho guest   │
                                       │ (với mã refund) │
                                       └─────────────────┘

┌─────────────────────────────────────────────────────────────────────────┐
│                    GUEST REFUND TRACKING                               │
└─────────────────────────────────────────────────────────────────────────┘

  Cách guest theo dõi refund:
  1. Qua email: Nhận email với mã REF-XXX
  2. Truy cập: GET /api/refunds/guest/:refundCode?email=xxx
  3. Verify: So sánh email với guest_email trong DB

  Link Guest refunds với User account (sau khi đăng nhập):
  - Khi guest đăng nhập → link refunds theo email
  - is_linked = true, linked_at = NOW()
  - requested_by = user_id
```

---

### 2.9 Database Schema

```sql
-- Bảng refunds (theo dõi yêu cầu hoàn tiền)
CREATE TABLE refunds (
  id                    BIGSERIAL PRIMARY KEY,
  refund_code           VARCHAR(20)    NOT NULL UNIQUE,  -- Format: REF-YYYYMMDD-XXXXXX
  
  -- Liên kết
  booking_id            BIGINT         NOT NULL REFERENCES bookings(id),
  payment_id            BIGINT         NULL,  -- Nullable vì có thể không có payment
  
  -- Loại refund
  refund_type           VARCHAR(20)    NOT NULL DEFAULT 'full',
  -- 'full' | 'partial_leg' | 'partial_passenger'
  
  -- Chi tiết refund
  requested_items       JSONB          NULL,
  -- { "passenger_ids": [1,2], "legs": ["outbound"] }
  
  refund_amount         NUMERIC(12,2)  NOT NULL DEFAULT 0,  -- Số tiền được hoàn (trước phí)
  admin_fee             NUMERIC(12,2)  NOT NULL DEFAULT 0,  -- Phí xử lý (hiện tại = 0)
  net_refund_amount     NUMERIC(12,2)  NOT NULL DEFAULT 0,  -- Số tiền thực nhận
  
  refund_policy_applied JSONB          NULL,
  -- { "name": "high_refund", "hoursBefore": 24, "refundPercent": 80 }
  
  -- Trạng thái
  status                VARCHAR(20)    NOT NULL DEFAULT 'pending',
  -- 'pending' | 'approved' | 'rejected' | 'processing' | 'completed' | 'cancelled' | 'failed'
  
  -- Lý do & ghi chú
  reason                TEXT          NULL,  -- Lý do user yêu cầu
  user_notes            TEXT          NULL,  -- Ghi chú thêm từ user
  admin_notes           TEXT          NULL,  -- Ghi chú từ admin
  
  -- Ai tạo & duyệt
  requested_by          BIGINT         NULL,  -- User ID (NULL nếu là guest)
  processed_by          BIGINT         NULL,  -- Admin ID
  
  -- Guest support
  is_guest              BOOLEAN       DEFAULT FALSE,
  guest_email           VARCHAR(255)  NULL,
  guest_session_id      VARCHAR(100)  NULL,
  is_linked             BOOLEAN       DEFAULT FALSE,  -- Đã link với user account
  linked_at             TIMESTAMP     NULL,
  
  -- Thời gian
  processed_at         TIMESTAMP     NULL,
  completed_at          TIMESTAMP     NULL,
  
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  
  -- Ràng buộc
  CONSTRAINT chk_refund_type
    CHECK (refund_type IN ('full', 'partial_leg', 'partial_passenger')),
  CONSTRAINT chk_refund_status
    CHECK (status IN ('pending', 'approved', 'rejected', 'processing', 'completed', 'cancelled', 'failed')),
  CONSTRAINT chk_refund_amount_positive
    CHECK (refund_amount >= 0),
  CONSTRAINT chk_net_refund_positive
    CHECK (net_refund_amount >= 0)
);

-- Indexes
CREATE INDEX idx_refunds_booking_id ON refunds (booking_id);
CREATE INDEX idx_refunds_status ON refunds (status);
CREATE INDEX idx_refunds_requested_by ON refunds (requested_by);
CREATE INDEX idx_refunds_created_at ON refunds (created_at DESC);
CREATE INDEX idx_refunds_payment_id ON refunds (payment_id);
CREATE INDEX idx_refunds_guest_session ON refunds (guest_session_id);
CREATE INDEX idx_refunds_guest_email ON refunds (guest_email);

-- Unique constraint: Chỉ 1 pending/approved/processing refund cho mỗi booking
CREATE UNIQUE INDEX idx_refunds_unique_pending
  ON refunds (booking_id)
  WHERE status IN ('pending', 'approved', 'processing');
```

---

### 2.10 API Endpoints

#### 2.10.1 User Endpoints

| Method | Endpoint | Auth | Body | Mô tả |
|--------|----------|------|------|-------|
| POST | `/api/bookings/:bookingCode/refund` | User | `{ refund_type, requested_items, reason, user_notes }` | Yêu cầu hoàn tiền |
| GET | `/api/bookings/:bookingCode/refunds` | User | - | Danh sách refunds của booking |
| GET | `/api/refunds/my` | User | query: `?page=1&limit=10` | Lịch sử refund của tôi |
| GET | `/api/refunds/:refundCode` | User | - | Chi tiết refund |
| DELETE | `/api/refunds/:refundCode` | User | Body: `{ reason }` | Hủy yêu cầu (pending/approved) |

#### 2.10.2 Guest Endpoints

| Method | Endpoint | Auth | Body | Mô tả |
|--------|----------|------|------|-------|
| POST | `/api/bookings/:bookingCode/refund/guest` | None | `{ email, refund_type, reason, ... }` | Yêu cầu refund (guest) |
| GET | `/api/refunds/guest/:refundCode` | None | query: `?email=xxx` | Xem chi tiết refund (guest) |

#### 2.10.3 Admin Endpoints

| Method | Endpoint | Auth | Body | Mô tả |
|--------|----------|------|------|-------|
| GET | `/api/admin/refunds` | Admin | query: `?status=&page=&limit=` | Danh sách (filter) |
| GET | `/api/admin/refunds/pending` | Admin | - | Danh sách chờ duyệt |
| GET | `/api/admin/refunds/stats` | Admin | query: `?from=&to=` | Thống kê refunds |
| GET | `/api/admin/refunds/:refundCode` | Admin | - | Chi tiết refund |
| POST | `/api/admin/refunds/:refundCode/approve` | Admin | `{ admin_notes }` | Duyệt refund |
| POST | `/api/admin/refunds/:refundCode/reject` | Admin | `{ reason }` | Từ chối refund |
| POST | `/api/admin/refunds/:refundCode/complete` | Admin | - | Hoàn thành (gọi gateway) |
| POST | `/api/admin/refunds/:refundCode/cancel` | Admin | `{ reason }` | Hủy refund |

#### 2.10.4 Flight Cancellation Endpoints

| Method | Endpoint | Auth | Body | Mô tả |
|--------|----------|------|------|-------|
| POST | `/api/admin/flights/:flightId/cancel-with-refunds` | Admin | `{ reason, create_full_refund }` | Hủy chuyến + auto refund |

---

### 2.11 File Structure

```
src/
├── config/
│   └── refund.config.js         ← Cấu hình policies, fees, SLA
├── services/
│   └── refund.service.js        ← Business logic chính
├── queries/
│   └── refund.queries.js       ← SQL queries
├── controllers/
│   ├── refund.controller.js     ← User endpoints
│   └── admin/
│       ├── refund.controller.js ← Admin endpoints
│       └── flight-cancellation.controller.js ← Hủy chuyến bay
├── routes/
│   └── refund.routes.js         ← User routes
└── providers/
    ├── paypal.provider.js       ← PayPal refund API
    └── payos.provider.js        ← PayOS integration
```

---

### 2.12 Configuration

```javascript
// refund.config.js

// 1. Time-based Policies
const POLICIES = [
  { name: 'full_refund', hoursBefore: 72, refundPercent: 100 },
  { name: 'high_refund', hoursBefore: 24, refundPercent: 80 },
  { name: 'medium_refund', hoursBefore: 12, refundPercent: 50 },
  { name: 'low_refund', hoursBefore: 0, refundPercent: 0 },
];

// 2. Admin Fee
const ADMIN_FEE = {
  enabled: true,
  percent: 0,  // 0% = Miễn phí
  minAmount: 0,
  maxAmount: 0,
  exemptStatuses: ['full_refund'],
};

// 3. Voucher Handling
const VOUCHER_HANDLING = {
  refundOnFinalAmount: true,  // true = refund trên số đã trả (sau voucher)
};

// 4. Validation
const VALIDATION = {
  minRefundAmount: 0,
  requireReason: true,
  minReasonLength: 10,
};

// 5. Race Condition Protection
const CONCURRENCY = {
  preventDuplicateRequests: true,
};

// 6. SLA
const SLA = {
  maxProcessingDays: 7,
  escalationThresholdHours: 48,
  autoRejectAfterDays: 30,
  autoCompleteOnApproval: false,
};
```

---

### 2.13 Integration Với Loyalty System

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REFUND → LOYALTY INTEGRATION                        │
└─────────────────────────────────────────────────────────────────────────┘

  Khi refund completed (admin gọi processRefund):

  1. Revoke loyalty points:
     ┌─────────────────────────────────────────────────────────────┐
     │ revokePointsForRefund(                                    │
     │   bookingId,                                              │
     │   userId,          // requested_by từ refund record       │
     │   refundType,      // 'full' | 'partial_leg' | 'partial'  │
     │   refundPercent    // 100 hoặc tỷ lệ % đã refund          │
     │ )                                                         │
     └─────────────────────────────────────────────────────────┘

  2. Logic revoke:
     ┌─────────────────────────────────────────────────────────────┐
     │ Full refund (100%):                                        │
     │   → Revoke toàn bộ điểm đã earn từ booking                │
     │                                                             │
     │ Partial refund (% < 100):                                  │
     │   → Revoke theo tỷ lệ: points × (refundPercent / 100)    │
     └─────────────────────────────────────────────────────────────┘

  3. Points bị ảnh hưởng:
     ┌─────────────────────────────────────────────────────────────┐
     │ tier_points:    - Số điểm bị revoke                        │
     │ current_points: - Số điểm bị revoke                        │
     │ lifetime_points: KHÔNG ĐỔI (lịch sử vĩnh viễn)           │
     └─────────────────────────────────────────────────────────────┘

  4. Check tier downgrade:
     ┌─────────────────────────────────────────────────────────────┐
     │ Nếu tier_points giảm xuống dưới ngưỡng → tụt tier        │
     │ → Notify user về việc tụt hạng                            │
     └─────────────────────────────────────────────────────────────┘
```

---

### 2.14 Edge Cases

| Trường hợp | Xử lý |
|-----------|--------|
| Refund khi payment_id null | Bỏ qua gateway call, vẫn cập nhật refund status |
| Payment không tìm thấy | Log warning, return true để không block refund |
| Gateway call fail | Cập nhật status = 'failed', throw error |
| User hủy refund đang processing | Không cho phép, chỉ hủy pending/approved |
| Nhiều refund cho 1 booking | Unique constraint → chỉ cho phép 1 pending/approved/processing |
| Booking đã khởi hành | Validate fail → "Không thể refund: Chuyến bay đã khởi hành" |
| Booking không phải confirmed | Validate fail → "Chỉ booking đã thanh toán mới được refund" |
| Refund amount < min | Validate fail → "Số tiền hoàn không đủ để xử lý" |

---

### 2.15 SLA Configuration

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    SLA (SERVICE LEVEL AGREEMENT)                        │
└─────────────────────────────────────────────────────────────────────────┘

  maxProcessingDays: 7 ngày
  ─────────────────────
  Từ khi refund được duyệt (approved) đến khi hoàn thành (completed)
  không được quá 7 ngày.

  escalationThresholdHours: 48 giờ
  ───────────────────────────────
  Nếu refund pending > 48 giờ chưa xử lý → alert cho admin.

  autoRejectAfterDays: 30 ngày
  ───────────────────────────────
  Nếu refund cần documents mà user không gửi sau 30 ngày → tự động reject.

  autoCompleteOnApproval: false
  ───────────────────────────────
  Khi approve → KHÔNG tự động complete.
  Admin phải gọi /complete riêng để trigger payment gateway.
```

---

### 2.16 Notification Events

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    REFUND NOTIFICATION EVENTS                           │
└─────────────────────────────────────────────────────────────────────────┘

  Email Notifications (enabled = true):
  ─────────────────────────────────────
  1. REFUND_REQUESTED     → Gửi xác nhận cho user + alert cho admin
  2. REFUND_APPROVED      → Thông báo user đã duyệt
  3. REFUND_REJECTED      → Thông báo user bị từ chối + lý do
  4. REFUND_COMPLETED     → Thông báo hoàn tiền thành công
  5. REFUND_FAILED        → Thông báo hoàn tiền thất bại + retry

  Date Change Notifications:
  ───────────────────────────
  1. DATE_CHANGE_REQUESTED    → Xác nhận user yêu cầu
  2. DATE_CHANGE_APPROVED     → Thông báo đổi ngày thành công
  3. DATE_CHANGE_REJECTED     → Thông báo bị từ chối

  Flight Cancellation:
  ───────────────────
  1. FLIGHT_CANCELLED     → Thông báo hủy chuyến + auto refund info

  Admin Dashboard Alerts:
  ───────────────────────
  - alertOnNewRefund: Có → Khi có refund mới
  - alertOnSLABreach: Có → Khi refund quá SLA
  - dailyRefundReport: Không
```

---

## PHẦN 3: TÍCH HỢP REFUND VỚI BOOKING

### 3.1 Booking Status Updates

```
┌─────────────────────────────────────────────────────────────────────────┐
│                    BOOKING STATUS TRACKING                             │
└─────────────────────────────────────────────────────────────────────────┘

  Booking Confirmed
        │
        ▼
  ┌──────────────┐
  │  confirmed   │◀────────────────────────────────────┐
  └──────┬───────┘                                     │
         │                                             │
         │ User yêu cầu refund                        │ Refund bị reject
         ▼                                             │ hoặc cancel
  ┌──────────────┐                                     │
  │ refund_pending│────────────────────────────────────┤
  └──────┬───────┘                                     │
         │                                             │
         │ Admin duyệt (approve)                      │
         ▼                                             │
  ┌──────────────┐                                     │
  │ refund_pending│ (vẫn giữ nguyên)                   │
  │ (approved)   │                                     │
  └──────┬───────┘                                     │
         │                                             │
         │ Admin gọi complete                         │
         │ (hoặc hệ thống tự động)                   │
         ▼                                             │
  ┌──────────────┐                                     │
  │  refunded    │────────────────────────────────────┘
  └──────────────┘     Hoặc booking bị cancel trực tiếp
                       (chưa thanh toán)

  Note: Chỉ confirmed booking mới được refund
```

---

## PHẦN 4: TEST COMMANDS (POSTMAN)

### 4.1 User Refund Tests

```bash
# 1. Yêu cầu hoàn tiền (User)
POST http://localhost:3000/api/bookings/{BOOKING_CODE}/refund
Content-Type: application/json
Authorization: Bearer {USER_TOKEN}

{
  "refund_type": "full",
  "reason": "Không thể đi chuyến bay này vì công việc đột xuất",
  "user_notes": "Rất mong được hoàn tiền sớm"
}

# 2. Xem Refunds của Booking
GET http://localhost:3000/api/bookings/{BOOKING_CODE}/refunds

# 3. Lịch sử Refund của User
GET http://localhost:3000/api/refunds/my?page=1&limit=10
Authorization: Bearer {USER_TOKEN}

# 4. Xem Chi tiết Refund
GET http://localhost:3000/api/refunds/{REFUND_CODE}
Authorization: Bearer {USER_TOKEN}

# 5. Hủy yêu cầu Refund
DELETE http://localhost:3000/api/refunds/{REFUND_CODE}
Authorization: Bearer {USER_TOKEN}
Body: { "reason": "Tôi đổi ý muốn giữ vé" }
```

### 4.2 Guest Refund Tests

```bash
# 1. Yêu cầu refund (Guest - không cần login)
POST http://localhost:3000/api/bookings/{BOOKING_CODE}/refund/guest
Content-Type: application/json

{
  "email": "guest@example.com",
  "refund_type": "full",
  "reason": "Thay đổi kế hoạch công tác"
}

# 2. Xem chi tiết refund (Guest)
GET http://localhost:3000/api/refunds/guest/{REFUND_CODE}?email= guest@example.com
```

### 4.3 Admin Refund Tests

```bash
# 1. Danh sách Refunds (filter theo status)
GET http://localhost:3000/api/admin/refunds?status=pending&page=1&limit=20
Authorization: Bearer {ADMIN_TOKEN}

# 2. Danh sách chờ duyệt
GET http://localhost:3000/api/admin/refunds/pending
Authorization: Bearer {ADMIN_TOKEN}

# 3. Thống kê Refunds
GET http://localhost:3000/api/admin/refunds/stats?from=2026-01-01&to=2026-12-31
Authorization: Bearer {ADMIN_TOKEN}

# 4. Duyệt Refund
POST http://localhost:3000/api/admin/refunds/{REFUND_CODE}/approve
Authorization: Bearer {ADMIN_TOKEN}
Body: { "admin_notes": "Đã kiểm tra, duyệt yêu cầu" }

# 5. Từ Chối Refund
POST http://localhost:3000/api/admin/refunds/{REFUND_CODE}/reject
Authorization: Bearer {ADMIN_TOKEN}
Body: { "reason": "Không đủ điều kiện hoàn tiền theo policy" }

# 6. Hoàn Thành Refund (gọi payment gateway)
POST http://localhost:3000/api/admin/refunds/{REFUND_CODE}/complete
Authorization: Bearer {ADMIN_TOKEN}

# 7. Hủy Refund
POST http://localhost:3000/api/admin/refunds/{REFUND_CODE}/cancel
Authorization: Bearer {ADMIN_TOKEN}
Body: { "reason": "Yêu cầu không hợp lệ" }
```

### 4.4 Flight Cancellation Tests

```bash
# Hủy chuyến bay + auto refund cho tất cả bookings
POST http://localhost:3000/api/admin/flights/{FLIGHT_ID}/cancel-with-refunds
Authorization: Bearer {ADMIN_TOKEN}
Body: {
  "reason": "Hủy chuyến bay do thời tiết xấu",
  "create_full_refund": true
}
```

---

## PHẦN 5: MIGRATIONS

### 5.1 Loyalty System

```
File: src/migrations/009_create_loyalty_tables.sql
─────────────────────────────────────────────────────
- Tạo bảng loyalty_notifications
- Seed 4 tiers: Member, Silver, Gold, Platinum
- Seed 6 rewards vouchers
```

### 5.2 Refund System

```
Files: src/migrations/010_create_refunds_table.sql
       src/migrations/011_create_date_change_requests.sql
       src/migrations/012_add_guest_support_to_refunds.sql
─────────────────────────────────────────────────────
- Tạo bảng refunds với đầy đủ columns
- Thêm guest support columns (is_guest, guest_email, guest_session_id, is_linked, linked_at)
- Tạo bảng date_change_requests
- Thêm indexes cho performance
```

---

## PHẦN 6: SUMMARY

### 6.1 Key Points - Membership

- **3 cột điểm**: lifetime (không giảm), tier (xét hạng), current (tiêu được)
- **4 tiers**: Member → Silver → Gold → Platinum
- **Multiplier**: 1.0 → 1.25 → 1.5 → 1.75
- **Redeem** chỉ trừ current_points, không ảnh hưởng tier
- **Cancel/Refund** trừ tier_points + current_points
- **Annual Reset** trừ 20% tier_points mỗi năm

### 6.2 Key Points - Refund

- **Time-based policies**: 72h (100%), 24-72h (80%), 12-24h (50%), <12h (0%)
- **3 refund types**: full, partial_leg, partial_passenger
- **Admin fee**: 0% (miễn phí)
- **Voucher handling**: refund trên final_amount (số đã trả)
- **Guest support**: refund không cần login
- **Payment gateways**: PayPal (API), PayOS/MoMo (manual)
- **Loyalty revoke**: tự động revoke điểm khi refund completed
