# Hướng Dẫn Chạy Unit Test — Flight Tracker & Membership

## Tổng quan

Bài lab này áp dụng đúng theo mô hình AAA (Arrange – Act – Assert)
như file hướng dẫn C#, nhưng viết bằng **Node.js** và dùng
**node:test** (built-in từ Node 18+, không cần cài thêm gì).

```
tests/
└── unit/
    ├── flight.tracker.test.js     ← 7 test cases: getFlightPosition
    └── membership.service.test.js ← 10 test cases: getMembershipInfo,
                                       earnPointsAfterBooking,
                                       revokePointsOnCancel
```

---

## Bước 1 — Copy file test vào project

Chép 2 file vào thư mục `tests/unit/` trong project của bạn:

```
backend-log-function/
└── tests/
    └── unit/
        ├── flight.tracker.test.js        ← file mới
        ├── membership.service.test.js    ← file mới
        ├── flight.service.test.js        (có sẵn)
        └── ...
```

---

## Bước 2 — Kiểm tra Node.js version

```bash
node --version
```

Cần **Node 18 trở lên**. Nếu thấp hơn thì nâng Node:

```bash
# Dùng nvm (nếu đã cài)
nvm install 20
nvm use 20
```

---

## Bước 3 — Chạy từng file test riêng

```bash
cd backend-log-function

# Chỉ chạy flight tracker
node --test tests/unit/flight.tracker.test.js

# Chỉ chạy membership
node --test tests/unit/membership.service.test.js
```

---

## Bước 4 — Chạy tất cả test cùng lúc

```bash
node --test tests/unit/*.test.js
```

Hoặc dùng script đã có trong package.json:

```bash
npm test
```

---

## Bước 5 — Đọc kết quả

Khi test **PASS**:
```
✔ getFlightPosition: ném lỗi khi flight_id không tồn tại (3.12ms)
✔ getFlightPosition: status = scheduled khi chưa đến giờ bay (0.45ms)
✔ getMembershipInfo: tier Member khi có 0 điểm (1.02ms)
...
ℹ tests 17
ℹ pass 17
ℹ fail 0
```

Khi test **FAIL** (ví dụ logic tính điểm sai):
```
✖ earnPointsAfterBooking: tính đúng điểm với multiplier Member (x1.0)
  AssertionError: pointsEarned phải = 50, thực tế: 45
    Expected: 50
    Actual:   45
```

→ Đọc dòng **Expected** và **Actual** để biết sai ở đâu, rồi sửa code trong `src/services/`.

---

## Giải thích kỹ thuật Mock

Vì service dùng `pool.query()` để truy vấn database,
ta **không cần chạy DB thật** khi test. Thay vào đó,
inject hàm giả vào `require.cache`:

```
┌─────────────────────┐      require.cache[db.js]
│  flight.service.js  │ ──→  { query: fakeQuery }   ← stub
│  loyalty.service.js │
└─────────────────────┘
         ↓
   Hàm fakeQuery trả về data mẫu do mình kiểm soát
```

Mỗi test có `fakeQuery` riêng → **isolate hoàn toàn**, không phụ thuộc nhau.

---

## Sơ đồ AAA của từng test (ví dụ)

```
TEST: "earnPointsAfterBooking với Silver x1.25"

ARRANGE:  fakeQuery trả về multiplier = 1.25
          totalPrice = 1,000,000 VNĐ

ACT:      earnPointsAfterBooking(userId=1, bookingId=103, totalPrice=1_000_000)

ASSERT:   result.pointsEarned === 125
          (floor(1_000_000 / 10_000) * 1.25 = 100 * 1.25 = 125)
```

---

## Chạy với output dạng TAP (dễ đọc hơn)

```bash
node --test --test-reporter=tap tests/unit/flight.tracker.test.js
```

---

## Lưu ý khi bị lỗi

| Lỗi | Nguyên nhân | Cách sửa |
|-----|-------------|----------|
| `Cannot find module '../../src/...'` | Đặt file test sai thư mục | Đảm bảo file nằm trong `tests/unit/` |
| `TypeError: service.getFlightPosition is not a function` | Flight service chưa export hàm | Thêm `module.exports = { getFlightPosition, ... }` vào cuối service |
| `node:test` not found | Node version < 18 | Nâng Node lên 18+ |
