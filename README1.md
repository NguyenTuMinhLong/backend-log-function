# IVUDEE REWARDS - Membership & Loyalty System

Hệ thống **Chương trình Khách hàng Thân thiết** cho dự án **Flight Booking**.

---

## 🌟 Tính năng đã hoàn thành (Production Ready)

| Tính năng                                         | Trạng thái    | Chi tiết                                    |
| ------------------------------------------------- | ------------- | ------------------------------------------- |
| Tự động tạo membership khi user chưa có           | ✅ Hoàn thành | Tạo ngay khi user lần đầu booking           |
| Tích điểm tự động sau khi đặt vé thành công       | ✅ Hoàn thành | Hook trong `booking.service.js`             |
| Hệ thống Tier (Member → Silver → Gold → Platinum) | ✅ Hoàn thành | 4 cấp bậc với multiplier                    |
| Tự động nâng hạng (Auto Upgrade Tier)             | ✅ Hoàn thành | Khi tích đủ điểm sẽ tự nâng                 |
| **Không giảm hạng khi redeem**                    | ✅ Hoàn thành | Tier chỉ nâng, không downgrade khi đổi điểm |
| Redeem điểm lấy Voucher giảm giá cố định          | ✅ Hoàn thành | Sinh mã voucher ngẫu nhiên                  |
| Lịch sử giao dịch điểm (`loyalty_transactions`)   | ✅ Hoàn thành | Ghi rõ earn/redeem                          |
| API xem thông tin membership                      | ✅ Hoàn thành | `/api/loyalty/me`                           |
| API danh sách voucher & redeem                    | ✅ Hoàn thành | `/rewards` & `/redeem`                      |
| Route test nhanh tích điểm                        | ✅ Hoàn thành | `/test-earn`                                |

---

## 📊 Database Schema (đã chạy migration)

### Các bảng đã tạo:

- **`loyalty_tiers`** – Định nghĩa các cấp bậc
- **`user_loyalty`** – Thông tin membership của từng user
- **`loyalty_transactions`** – Lịch sử tích/đổi điểm
- **`loyalty_rewards`** – Danh sách voucher có thể đổi

**Tier mặc định đã seed:**

| Tier     | Min Points | Multiplier |
| -------- | ---------- | ---------- |
| Member   | 0          | 1.00x      |
| Silver   | 15.000     | 1.25x      |
| Gold     | 40.000     | 1.50x      |
| Platinum | 80.000     | 1.75x      |

---

## 📁 Cấu trúc File Module

```bash
src/
├── queries/
│   └── loyalty.queries.js          # Tất cả SQL queries
├── services/
│   └── loyalty.service.js          # Business logic (earn, redeem, upgrade tier)
├── controllers/
│   └── loyalty.controller.js       # Controller API
├── routes/
│   └── loyalty.routes.js           # Định nghĩa routes
└── services/
    └── booking.service.js          # Đã hook loyalty (earnPointsAfterBooking)


🔌 API Endpoints
Base URL: http://localhost:3000/api/loyalty
1. Xem thông tin Membership

GET /me
Hỗ trợ test: ?userId=8
Trả về: tier hiện tại, total_points, multiplier, lịch sử transaction

2. Xem danh sách Voucher có thể đổi

GET /rewards

3. Đổi điểm lấy Voucher

POST /redeem
Body:JSON{
  "rewardId": 1
}
Hỗ trợ test: ?userId=8

Voucher hiện có:

ID 1 → Voucher 100K (5.000 điểm)
ID 2 → Voucher 250K (10.000 điểm)
ID 3 → Voucher 500K (20.000 điểm)
ID 4 → Voucher 1M (40.000 điểm)

4. Test tích điểm (dùng để test nhanh)

GET /test-earn?userId=8&totalPrice=1200000


📋 Cách tính điểm

Công thức: 10.000 VNĐ = 1 điểm cơ bản
Nhân thêm multiplier theo tier hiện tại
Ví dụ: Vé 1.200.000 VNĐ ở tier Gold (1.5x) → được 180 điểm


🔄 Logic Redeem Voucher

Sinh mã voucher ngẫu nhiên: VOUCHER-7K9M2P4X
Không giảm hạng (tier giữ nguyên)
Trừ điểm + ghi lịch sử transaction (type = 'redeem')
Response trả về đầy đủ mã voucher để user dùng


🧪 Cách Test (Postman)
Test thứ tự khuyến nghị:

Tích điểm: GET /test-earn?userId=8&totalPrice=1200000 (chạy nhiều lần)
Xem membership: GET /me?userId=8
Xem danh sách voucher: GET /rewards
Redeem: POST /redeem?userId=8 với body {"rewardId": 1}


⚠️ Lưu ý quan trọng

Chỉ tích điểm khi booking thành công và có userId
Tier chỉ nâng khi earn điểm, không giảm khi redeem
booking_id trong transaction có thể là null (test) hoặc ID thật
Có console log rõ ràng với prefix [Loyalty] để debug
Voucher code được sinh ngẫu nhiên mỗi lần redeem


🚀 Cách mở rộng sau này (Todo)

 Reset tier hàng năm (1/1 hoặc ngày kỷ niệm)
 Lưu voucher code vào bảng riêng (user_vouchers)
 Redeem voucher khi thanh toán booking (áp dụng tự động)
 Voucher theo sự kiện (Black Friday, sinh nhật…)
 Tier reset + điểm giữ lại hoặc reset theo policy


Module IVUDEE REWARDS đã hoàn thiện và ổn định.
Ngày hoàn thành: 14/05/2026
```
