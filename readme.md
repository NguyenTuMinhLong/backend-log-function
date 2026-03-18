WARNING: **USER**

# Migration SQL (user + user_otps + refresh_tokens)
001_create_user_tables.sql



WARNING: **Search Flight**

# Migration SQL (tạo bảng cho flight + seed vài data mẫu)
002_create_flight_tables.sql
# Flight Service (logic search)
flight.service.js
# Flight Controller
flight.controller.js
# Flight Routes
flight.routes.js
# Đăng ký route vào app.js
app.js

# Test Postman
**Tìm kiếm chuyến bay**
GET http://localhost:5000/api/flights/search?departure_code=HAN&arrival_code=SGN&departure_date=2026-03-20&passengers=1&seat_class=economy
**Danh sách sân bay - Frontend render dropdown "Chọn điểm đi / điểm đến"**
GET http://localhost:5000/api/flights/airports
**Danh sách hãng hàng không - Frontend render bộ lọc "Chọn hãng"**
GET http://localhost:5000/api/flights/airlines
**Chi tiết 1 chuyến bay - Người dùng click vào một chuyến bay cụ thể để xem đầy đủ thông tin. Trả về: toàn bộ thông tin chuyến bay ID=3 kèm tất cả hạng ghế**
GET http://localhost:5000/api/flights/<chỗ này nhập id chuyến bay>
**Một chiều**
GET http://localhost:5000/api/flights/search?departure_code=HAN&arrival_code=SGN&departure_date=2026-03-19&passengers=2&seat_class=economy&sort_by=price_asc
**Khứ hồi:**
GET http://localhost:5000/api/flights/search?departure_code=HAN&arrival_code=SGN&departure_date=2026-03-19&return_date=2026-03-25&passengers=2&seat_class=economy&sort_by=price_asc
**Filter thì thêm này vô link:** &min_price=500000&max_price=1000000&airline_code=VJ



WARNING: **View Flight Detail**

