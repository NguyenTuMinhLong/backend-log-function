# Refund & Date Change - Logic Documentation

## 1. REFUND SYSTEM

### 1.1 Policy
- Tat ca refunds deu phai xac thuc **OTP**
- **< 1M VND** -> Auto approve (hoan tien ngay)
- **>= 1M VND** -> Admin duyet thu cong

### 1.2 Flow

```
User/Guest submit refund
         |
         v
    [Gui OTP email]
         |
         v
    [Verify OTP]
         |
         v
    [Kiem tra so tien]
         |
    +--< 1M --> Auto approve --> Hoan tien
    |
    +-->= 1M --> Status: pending --> Cho admin duyet
```

### 1.3 User Refund Flow
```
1. POST /api/refunds/user/request-otp  (gui OTP)
2. POST /api/refunds/user/verify-otp   (verify OTP)
3. POST /api/refunds/user             (submit refund)
```

### 1.4 Guest Refund Flow
```
1. POST /api/refunds/guest/request-otp  (gui OTP)
2. POST /api/refunds/guest/verify-otp   (verify OTP)
3. POST /api/refunds/guest             (submit refund)
```

### 1.5 Admin Refund APIs
```
GET  /api/admin/refunds              (list refunds)
GET  /api/admin/refunds/:code       (chi tiet)
POST /api/admin/refunds/:code/approve  (duyet)
POST /api/admin/refunds/:code/reject   (tu choi)
```

### 1.6 Config
```javascript
// src/config/refund.config.js
OTP_CONFIG: {
  enabled: true,
  threshold: 0,  // Moi refund deu can OTP
}

AUTO_REFUND: {
  enabled: true,
  threshold: 1000000,  // 1 trieu VND
}
```

---

## 2. DATE CHANGE SYSTEM

### 2.1 Policy
- Tat ca date changes deu phai xac thuc **OTP**
- **< 1M VND** (chenh lech gia) -> Auto approve
- **>= 1M VND** -> Admin duyet thu cong

### 2.2 Flow
```
User request date change
         |
         v
    [Tao request + Gui OTP]
         |
         v
    [Status: pending_otp]
         |
         v
    POST /api/date-changes/confirm
    [Verify OTP]
         |
         v
    [Kiem tra chenh lech gia]
         |
    +--< 1M --> Auto approve --> Cap nhat booking
    |
    +-->= 1M --> Status: pending --> Cho admin duyet
```

### 2.3 APIs

#### User APIs
```
POST /api/date-changes/bookings/:bookingCode/change-flight  (request + gui OTP)
POST /api/date-changes/confirm                            (verify OTP)
GET  /api/date-changes/:requestCode                       (chi tiet)
DELETE /api/date-changes/:requestCode                     (huy)
```

#### Admin APIs
```
GET  /api/admin/date-changes              (list)
POST /api/date-changes/:code/approve      (duyet)
POST /api/date-changes/:code/reject       (tu choi)
```

### 2.4 Status Values
```
pending      - Cho xu ly (backup)
pending_otp  - Dang cho OTP verification
approved     - Da duyet
rejected     - Tu choi
completed    - Hoan tat
cancelled    - Da huy
```

---

## 3. OTP SYSTEM

### 3.1 Refund OTP
- Luu trong Map theo email
- Hieu luc: 5 phut
- So lan thu toi da: 3

### 3.2 Date Change OTP
- Luu trong `dateChangeOTPStore` Map
- Key: email (lowercase)
- Value: { code, requestCode, expiresAt, attempts, verified }

### 3.3 Debug
- Trong moi truong dev, OTP se in ra console:
```
[DateChange OTP] Code: 507585 for email@example.com
```

---

## 4. DATABASE CHANGES

### 4.1 Date Change Status Constraint
```sql
-- Migration: 018_update_date_change_status.sql
ALTER TABLE date_change_requests
ADD CONSTRAINT chk_date_change_status
  CHECK (status IN ('pending', 'pending_otp', 'approved', 'rejected', 'completed', 'cancelled'));
```

### 4.2 Unique Index
```sql
CREATE UNIQUE INDEX idx_date_changes_unique_pending
  ON date_change_requests (booking_id)
  WHERE status IN ('pending', 'pending_otp');
```

---

## 5. TESTING

### 5.1 Postman Collection
File: `postman/Refund_DateChange_Tests.postman_collection.json`

### 5.2 Test Cases

#### Refund < 1M (Auto)
1. Request OTP
2. Verify OTP
3. Submit refund -> Status: `approved`

#### Refund >= 1M (Manual)
1. Request OTP
2. Verify OTP
3. Submit refund -> Status: `pending`
4. Admin approve -> Status: `approved`

#### Date Change
1. Request change -> OTP gui, Status: `pending_otp`
2. Confirm with OTP -> < 1M auto approve, >= 1M pending
3. Admin approve neu can

---

## 6. NOTES

- OTP bat buoc cho **tat ca** refunds va date changes
- Auto refund chi ap dung khi **net_refund_amount < 1M**
- Auto approve date change chi ap dung khi **|price_difference| < 1M**
- Admin luon co the duyet/tu choi cac request
