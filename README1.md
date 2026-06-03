# Changes Log - Date Change Payment & Flight Combo

## 1. Date Change with Payment

### Flow tổng quan

```
1. User request change
   POST /api/date-changes/bookings/:bookingCode/change-flight
   → Tạo request + gửi OTP email
   → Status: pending_otp

2. User confirm với OTP
   POST /api/date-changes/confirm
   → Verify OTP
   → Tính chênh lệch giá

   ┌─ price_difference > 0 (khách trả thêm)
   │   → Status: pending_payment
   │   → Tạo payment riêng
   │
   ├─ price_difference = 0
   │   → Auto approve luôn
   │
   └─ price_difference < 0 (giá mới rẻ hơn)
       → Auto approve luôn (không hoàn tiền tự động)
       → Admin duyet neu > 1M
```

### Tính chênh lệch giá

```javascript
priceDifference = (newFlight.base_price * soVe) - booking.total_price

// Ví dụ:
booking cu = 3,000,000 VND (3 vé)
chọn flight mới = 1,800,000 VND/ghế
→ priceDifference = 1,800,000 * 3 - 3,000,000 = +2,400,000
→ Khách phải trả thêm 2.4M
```

### APIs mới

```
POST /api/date-changes/bookings/:code/change-flight   - Request change
POST /api/date-changes/confirm                        - Confirm với OTP
POST /api/date-changes/:code/payment                 - Tạo payment cho chênh lệch
GET  /api/date-changes/:code/payment                  - Xem payment status
POST /api/date-changes/:code/payment/cancel           - Hủy payment
```

### OTP bắt buộc

Mọi date change đều cần verify OTP trước khi xử lý.

### Auto vs Manual

| price_difference | Action |
|------------------|--------|
| > 0 | Tạo payment, khách trả thêm |
| = 0 | Auto approve |
| < 0, \|value\| < 1M | Auto approve (không hoàn tiền tự động) |
| < 0, \|value\| >= 1M | Admin duyet |

---

## 2. Flight Combo - One Way & Round Trip

### Tìm kiếm multi-leg

API: `mixedSearch()` trong `flight-combo.service.js`

**One-way:** Direct (0 stop) + 1-stop + 2-stop

```
A → B           (direct)
A → X → B       (1 stop)
A → X → Y → B   (2 stop)
```

**Round-trip:** Cross-product outbound × return

```
Outbound: A → B
Return:   B → A
→ Kết hợp tất cả options
→ Limit: 30 combos mỗi direction để tránh quá nhiều kết quả
```

### Ranking logic

```javascript
score = price * 0.4 
      + duration * 0.3 
      + layover * 0.2
      - bonus_nếu_multi_airline

// Ưu tiên:
1. Giá rẻ
2. Thời gian bay ngắn
3. Thời gian chờ hợp lý (45 phút - 8 tiếng)
```

### Layover rules

```
MIN: 45 phút
MAX: 8 tiếng (480 phút)
```

### Response structure

```json
{
  "one_way_options": [
    {
      "stops": 0,
      "total_price": 2400000,
      "total_duration_minutes": 180,
      "legs": [
        {
          "flight_id": 1,
          "airline": { "code": "VN", "name": "Vietnam Airlines" },
          "departure": { "code": "HAN", "time": "..." },
          "arrival": { "code": "SGN", "time": "..." }
        }
      ]
    }
  ],
  "roundtrip_combinations": [...]
}
```

### Giá vé theo loại khách

```
Người lớn: base_price * 1
Trẻ em:    base_price * 0.75
Em bé:     base_price * 0.10
```

---

## 3. Flight Brand/Airline

Đơn giản: JOIN airlines là có đủ.

```sql
SELECT f.*, al.code, al.name, al.logo_url
FROM flights f
JOIN airlines al ON al.id = f.airline_id
```

Frontend nhận:
```json
{
  "airline": {
    "code": "VN",
    "name": "Vietnam Airlines",
    "logo_url": "..."
  }
}
```


