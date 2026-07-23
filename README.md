# Vivudee - Flight Booking Backend

Node.js + Express + PostgreSQL backend cho hệ thống đặt vé máy bay.

## Chức năng chính

### Auth
Register, login, OTP, refresh token, social auth, forgot/reset password, auto lock khi sai nhiều lần.

### Flight
Tìm kiếm chuyến bay, xem chi tiết, multi-leg (one-way / round-trip / multi-city).

### Booking
Tạo booking, xem booking, hủy booking, tự động expire giữ chỗ quá hạn.

### Payment
Hỗ trợ PayOS, MoMo, PayPal, BANK_QR. Preview, tạo, confirm payment.

### Admin
Quản lý flight, airport, airline, user, coupon, booking, thống kê.

---

## Date Change & Payment

### Luồng đổi ngày bay

```
1. POST /api/date-changes/bookings/:bookingCode/change-flight  → gửi OTP, status = pending_otp
2. POST /api/date-changes/confirm                            → verify OTP, xử lý chênh lệch giá
3. Admin approve nếu chênh lệch >= 1M
```

### Tính chênh lệch giá

```javascript
priceDifference = (newFlight.base_price * số_vé) - booking.total_price

// Kết quả:
// priceDifference > 0  → khách trả thêm (auto: tạo payment)
// priceDifference = 0  → không thay đổi
// priceDifference < 0  → hoàn tiền (auto: refund)
// priceDifference có |value| < 1M → auto approve
```

### OTP bắt buộc cho mọi date change

---

## Flight Brand / Airline

Đơn giản: mỗi flight join bảng `airlines` là có đủ thông tin.

```sql
-- Flight query luôn join airlines
SELECT f.*, al.code AS airline_code, al.name AS airline_name, al.logo_url ...
FROM flights f
JOIN airlines al ON al.id = f.airline_id
```

Frontend nhận:
```json
{
  "airline": {
    "code": "VN",
    "name": "Vietnam Airlines",
    "logo_url": "https://..."
  }
}
```

---

## Config

Xem `src/config/` - mỗi feature có config riêng: `auth.config.js`, `payment.config.js`, `refund.config.js`.

## API Docs

Postman collection trong `postman/` folder.

---

## Sequence Diagrams

Document chi tiết các flows trong hệ thống: [docs/diagrams/sequence/](docs/diagrams/sequence/)

| Diagram | Mô tả |
|---------|--------|
| [01-auto-refund.md](docs/diagrams/sequence/01-auto-refund.md) | User request → Admin approve → Payment gateway → Complete |
| [02-date-change.md](docs/diagrams/sequence/02-date-change.md) | Request → OTP → Payment → Approve → Release/Reserve seats |
| [03-flight-combo.md](docs/diagrams/sequence/03-flight-combo.md) | Mixed search: direct, 1-stop, 2-stop + roundtrip |
| [04-flight-season.md](docs/diagrams/sequence/04-flight-season.md) | Season/Holiday/Override detection với caching |
