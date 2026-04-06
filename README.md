# Vivudee Flight Booking Backend

Backend API cho hệ thống **Vivudee - Flight Booking System**, xây dựng bằng **Node.js + Express + PostgreSQL**. Project cung cấp các chức năng xác thực người dùng, tìm kiếm chuyến bay, tạo booking, thanh toán, quản trị dữ liệu hệ thống và tích hợp social auth / gửi OTP qua email.

## 1. Tech stack

- **Runtime:** Node.js
- **Framework:** Express.js
- **Database:** PostgreSQL (`pg`)
- **Authentication:** JWT + Refresh Token + OTP
- **Social Auth:** Supabase Auth
- **Email Service:** Resend / Nodemailer wrapper
- **Password Hashing:** bcrypt
- **Dev tool:** nodemon

## 2. Kiến trúc thư mục

```text
.
├── scripts/
│   └── seedAdmin.js
├── src/
│   ├── config/
│   │   ├── db.js
│   │   └── supabase.js
│   ├── controllers/
│   ├── middlewares/
│   ├── migrations/
│   ├── routes/
│   ├── services/
│   ├── utils/
│   ├── app.js
│   └── server.js
├── postman/
├── test-supabase.html
├── package.json
└── README.md
```

### Phân lớp chính

- **routes/**: định nghĩa endpoint
- **controllers/**: nhận request, trả response
- **services/**: xử lý business logic
- **middlewares/**: xác thực, phân quyền, social auth
- **config/**: cấu hình DB, Supabase
- **utils/**: JWT, password, OTP, mailer, seat assignment
- **migrations/**: SQL khởi tạo schema

## 3. Chức năng chính

### Authentication
- Đăng ký tài khoản
- Xác thực OTP đăng ký
- Gửi lại OTP
- Đăng nhập
- Refresh token
- Lấy thông tin user hiện tại
- Đổi mật khẩu
- Quên mật khẩu / reset mật khẩu bằng OTP
- Đăng xuất
- Social auth profile với Supabase
- Tự khóa tạm thời khi đăng nhập sai nhiều lần

### Flight
- Tìm kiếm chuyến bay theo điểm đi, điểm đến, ngày bay, hạng ghế
- Lấy danh sách sân bay
- Lấy danh sách hãng hàng không
- Xem chi tiết chuyến bay

### Booking
- Tạo booking cho guest hoặc user đã đăng nhập
- Xem booking theo mã
- Xem danh sách booking của tôi
- Hủy booking
- Tự động expire booking giữ chỗ quá hạn

### Payment
- Preview thanh toán
- Tạo payment
- Confirm payment
- Xem lịch sử thanh toán của user
- Hỗ trợ voucher / coupon trong luồng thanh toán

### Admin
- Quản lý chuyến bay
- Quản lý sân bay
- Quản lý hãng hàng không
- Quản lý user
- Quản lý coupon
- Quản lý booking
- Xem thống kê hệ thống

### Public API
- Danh sách sân bay
- Danh sách hãng hàng không
- Danh sách coupon public / available

## 4. API chính

### Auth

```text
POST   /api/auth/register
POST   /api/auth/login
POST   /api/auth/verify-register-otp
POST   /api/auth/forgot-password
POST   /api/auth/verify-reset-otp
POST   /api/auth/reset-password
POST   /api/auth/refresh
GET    /api/auth/me
POST   /api/auth/change-password
POST   /api/auth/set-password
POST   /api/auth/logout
POST   /api/auth/resend-otp
GET    /api/auth/social/me
```

### Flight

```text
GET    /api/flights/search
GET    /api/flights/airports
GET    /api/flights/airlines
GET    /api/flights/:id
```

### Booking

```text
GET    /api/bookings/my
POST   /api/bookings
GET    /api/bookings/:bookingCode
POST   /api/bookings/:bookingCode/cancel
```

### Payment

```text
POST   /api/payments/preview
POST   /api/payments
POST   /api/payments/:paymentCode/confirm
GET    /api/payments/my
```

### Public

```text
GET    /api/airports
GET    /api/airlines
GET    /api/coupons
GET    /api/coupons/available
```

### Admin

```text
GET    /api/admin/flights
POST   /api/admin/flights
PUT    /api/admin/flights/:id
PATCH  /api/admin/flights/:id/status
PATCH  /api/admin/flights/:id/visibility

GET    /api/admin/airports
POST   /api/admin/airports
PUT    /api/admin/airports/:id
PATCH  /api/admin/airports/:id/status

GET    /api/admin/airlines
POST   /api/admin/airlines
PUT    /api/admin/airlines/:id
PATCH  /api/admin/airlines/:id/status

GET    /api/admin/users
GET    /api/admin/users/:id
PATCH  /api/admin/users/:id/status
PATCH  /api/admin/users/:id/role

GET    /api/admin/coupons
GET    /api/admin/coupons/:id
POST   /api/admin/coupons
PUT    /api/admin/coupons/:id
PATCH  /api/admin/coupons/:id/status
DELETE /api/admin/coupons/:id

GET    /api/admin/bookings
GET    /api/admin/bookings/:id
PATCH  /api/admin/bookings/:id/status
GET    /api/admin/statistics
```
## 5. Luồng tự động hết hạn giữ chỗ

Trong hệ thống cứ mỗi **60 giây** sẽ chạy để kiểm tra booking đang giữ chỗ và tự động hủy booking đã quá thời gian giữ ghế.

## 6. Postman

Thư mục `postman/` chứa collection phục vụ test nhanh API admin coupon.