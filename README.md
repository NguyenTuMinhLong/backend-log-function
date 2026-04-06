# Vivudee - Flight Booking System - Backend

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

## 2. Chức năng chính

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