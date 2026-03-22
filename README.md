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



NOTE: Của Tuấn

WARNING: **USER**

# Migration SQL (user + user_otps + refresh_tokens)
001_create_user_tables.sql

WARNING: **Search Flight & View Flight Detail**

# Migration SQL (tạo bảng cho flight + seed vài data mẫu)
002_create_flight_tables.sql
# Flight Service (logic search)
flight.service.js
# Flight Controller
flight.controller.js
# Flight Routes
flight.routes.js
# Test Postman
**Tìm kiếm chuyến bay**
GET http://localhost:5000/api/flights/search?departure_code=HAN&arrival_code=SGN&departure_date=2026-03-20&passengers=1&seat_class=economy
**Danh sách sân bay - Frontend render dropdown "Chọn điểm đi / điểm đến"**
GET http://localhost:5000/api/flights/airports
**Danh sách hãng hàng không - Frontend render bộ lọc "Chọn hãng"**
GET http://localhost:5000/api/flights/airlines
**Chi tiết 1 chuyến bay - Người dùng click vào một chuyến bay cụ thể để xem đầy đủ thông tin. Trả về: toàn bộ thông tin chuyến bay ID=3 kèm tất cả hạng ghế**
GET http://localhost:5000/api/flights/<chỗ này nhập id chuyến bay>
**Tìm kiếm chuyến bay một chiều**
GET http://localhost:5000/api/flights/search?departure_code=HAN&arrival_code=SGN&departure_date=2026-03-19&passengers=2&seat_class=economy&sort_by=price_asc
**Tìm kiếm chuyến bay khứ hồi:**
GET http://localhost:5000/api/flights/search?departure_code=HAN&arrival_code=SGN&departure_date=2026-03-19&return_date=2026-03-25&passengers=2&seat_class=economy&sort_by=price_asc
**Bonus tìm kiếm chuyến bay - Filter thì thêm này vô link:** &min_price=500000&max_price=1000000&airline_code=VJ



WARNING: **View Flight Detail**

# Migration SQL (tạo bảng cho bookings + passengers)
003_create_booking_tables.sql
# Booking Service (logic đặt vé, giữ ghế, tự hủy)
booking.service.js
# Booking Controller
booking.controller.js
# Booking Routes
booking.routes.js
# Test Postman
**Đặt vé (một chiều, guest):**
POST http://localhost:5000/api/bookings
Content-Type: application/json

{
  "outbound_flight_id": 1,
  "outbound_seat_class": "economy",
  "trip_type": "one_way",
  "adults": 1,
  "children": 0,
  "infants": 0,
  "contact_name": "Nguyễn Văn A",
  "contact_email": "test@gmail.com",
  "contact_phone": "0901234567",
  "passengers": [
    {
      "flight_type": "outbound",
      "passenger_type": "adult",
      "full_name": "Nguyễn Văn A",
      "gender": "male",
      "date_of_birth": "1995-05-15"
    }
  ]
}


**Đặt vé (hai chiều, guest):**
POST http://localhost:5000/api/bookings
Content-Type: application/json
{
  "outbound_flight_id": 1,
  "outbound_seat_class": "economy",
  "return_flight_id": 5,
  "return_seat_class": "economy",
  "trip_type": "round_trip",
  "adults": 1,
  "children": 0,
  "infants": 0,
  "contact_name": "Nguyễn Văn A",
  "contact_email": "test@gmail.com",
  "contact_phone": "0901234567",
  "passengers": [
    {
      "flight_type": "outbound",
      "passenger_type": "adult",
      "full_name": "Nguyễn Văn A",
      "gender": "male",
      "date_of_birth": "1995-05-15"
    },
    {
      "flight_type": "return",
      "passenger_type": "adult",
      "full_name": "Nguyễn Văn A",
      "gender": "male",
      "date_of_birth": "1995-05-15"
    }
  ]
}

SELECT id, flight_number, departure_time FROM flights;