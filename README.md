# Flight Booking Backend - Auth Module

Backend cho hệ thống đặt vé máy bay, xây dựng bằng:

- Node.js
- Express.js
- PostgreSQL
- JWT
- bcrypt
- Nodemailer

Hiện tại project tập trung vào **Auth Module** với các chức năng:

- Đăng ký tài khoản
- Xác thực email bằng OTP
- Gửi lại OTP
- Đăng nhập
- Lấy thông tin user hiện tại
- Đổi mật khẩu
- Quên mật khẩu
- Đặt lại mật khẩu bằng OTP
- Đăng xuất
- Khóa tài khoản tạm thời sau nhiều lần đăng nhập sai

---

# 1. Công nghệ sử dụng

- Node.js
- Express
- PostgreSQL
- pg
- bcrypt
- jsonwebtoken
- dotenv
- cors
- nodemailer

---

# 2. Cài đặt môi trường

## 2.1 Cài Node.js
Cài Node.js bản LTS từ trang chính thức.

Kiểm tra:

bash
node -v
npm -v
