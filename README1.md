# README ghi chú thay đổi gần đây

File này là bản note nội bộ, viết theo kiểu dễ đọc để ai vào sau cũng hiểu nhanh là hệ thống vừa được cập nhật gì, tại sao cập nhật, và hành vi hiện tại đang như thế nào.

---

## 1. Date change: luồng đổi ngày bay đã rõ hơn và tách thành 2 bước

Trước đây phần date change hơi dễ gây hiểu nhầm vì nhìn như chỉ cần gửi request là xong. Hiện tại flow đã rõ hơn: user gửi yêu cầu trước, sau đó phải xác thực OTP rồi hệ thống mới quyết định đi tiếp theo nhánh nào.

### Flow đang chạy

**Bước 1: user tạo yêu cầu đổi ngày**
- Endpoint: `POST /api/date-changes/bookings/:bookingCode/change-flight`
- Input chính: `new_flight_id`, `new_seat_class`, `reason`
- Hệ thống sẽ:
  - check booking có hợp lệ không
  - check user có quyền với booking đó không
  - check đã có request đang pending cho booking này chưa
  - check flight mới có đủ ghế không
  - tính chênh lệch giá
  - tạo request với status `pending_otp`
  - gửi OTP về email booking

**Bước 2: user xác thực OTP**
- Endpoint: `POST /api/date-changes/confirm`
- Sau khi OTP đúng thì hệ thống không approve ngay trong mọi trường hợp nữa, mà chia nhánh theo `price_difference`

### Cách tính chênh lệch giá hiện tại

Hiện tại service đang so sánh phần **giá vé outbound cơ bản theo số ghế**, chứ không lấy toàn bộ `booking.total_price` để trừ như cách hiểu dễ nhầm trước đó.

Công thức đang dùng là:

```javascript
newTotalPrice = newFlight.base_price * seatsNeeded;
oldPrice = booking.base_price * seatsNeeded;
priceDifference = newTotalPrice - oldPrice;
```

Ý nghĩa của cách này:
- chỉ so sánh phần vé đổi thực tế
- không lẫn baggage / ancillary / chiều về
- dễ kiểm soát hơn khi xử lý business rule cho date change

### Sau khi OTP đúng thì đi nhánh nào?

#### Trường hợp 1: `price_difference > 0`
Khách phải trả thêm.

Hệ thống sẽ:
- update request sang `pending_payment`
- trả về `requires_payment: true`
- chờ user tạo payment riêng cho khoản chênh lệch

Endpoint tiếp theo:
- `POST /api/date-changes/:code/payment`
- `GET /api/date-changes/:code/payment`
- `POST /api/date-changes/:code/payment/cancel`

#### Trường hợp 2: `price_difference <= 0`
Hiện tại không còn auto approve ngay sau OTP theo kiểu cũ nữa.

Flow bây giờ là:
- request được set về `pending`
- sau đó mới xét rule auto approve theo threshold config
- nếu đủ điều kiện thì service gọi approve luôn
- nếu không đủ điều kiện thì request ở trạng thái chờ admin duyệt

Nói ngắn gọn: OTP xong không có nghĩa là luôn hoàn tất, mà OTP chỉ là bước xác nhận để hệ thống chuyển sang giai đoạn xử lý chính thức.

### Payment cho date change đã tách riêng

Phần thanh toán phụ phí đổi ngày giờ đã có flow riêng hẳn, không dính chung với payment booking gốc.

Hiện service đã xử lý:
- lock request để tránh race condition
- chỉ cho tạo payment khi status là `pending_payment`
- không cho tạo payment nếu request không cần trả thêm
- reuse payment cũ nếu payment đó vẫn còn hiệu lực và chưa terminal

Các method đang support theo config:
- `BANK_QR`
- `MOMO`
- `PAYPAL`

### Ý chính cần nhớ về date change

- Có OTP bắt buộc
- Có tách nhánh `pending_payment` riêng cho trường hợp khách phải bù tiền
- Phần so sánh giá hiện tại dùng **base outbound fare x số ghế**
- Trường hợp không cần trả thêm thì đi qua nhánh `pending` rồi mới auto-approve hoặc chờ admin, thay vì chốt cứng ngay từ đầu

---

## 2. Flight combo: phần tìm chuyến ghép đã sạch logic hơn và đồng bộ pricing hơn

Phần `flight-combo` hiện tại không chỉ là tìm chuyến nối đơn giản nữa, mà đã được dọn khá rõ về validation, flow query và cách xếp hạng kết quả.

### Những loại combo đang có

Hiện service đang hỗ trợ:
- **direct**: bay thẳng
- **1-stop**: một điểm dừng
- **2-stop**: hai điểm dừng
- **roundtrip combinations**: ghép outbound với return

Tức là với một request tìm kiếm, hệ thống sẽ gom hết các option 1 chiều trước, rồi nếu có `return_date` thì build thêm tổ hợp khứ hồi.

### Validation đầu vào đã chặt hơn

Trước khi search, service đang validate khá rõ:
- bắt buộc có `from`, `to`, `outbound_date`
- ngày phải đúng format `YYYY-MM-DD`
- `return_date` không được sớm hơn `outbound_date`
- `seat_class` chỉ nhận `economy`, `business`, `first`
- `sort_by` chỉ nhận `recommended`, `price`, `duration`
- `max_stops` chỉ từ `0` đến `2`
- `infants` không được nhiều hơn `adults`

Điểm này nhỏ nhưng quan trọng vì giúp response đỡ bị lệch và giảm lỗi khó debug ở tầng query.

### Giá combo giờ đã ăn theo season logic

Mỗi leg khi format ra hiện tại đều có:
- `season_info`
- dynamic price đã nhân với season multiplier
- `seat.total_price` theo số lượng hành khách

Nghĩa là combo pricing bây giờ đã đồng bộ với pricing logic chung của flight search. Không còn kiểu combo tính một đường, season tính một đường.

### Flow tìm one-way đang như nào?

Service sẽ chạy theo `max_stops`:
- nếu cho phép `0 stop` thì lấy direct
- nếu cho phép `1 stop` thì lấy thêm 1-stop
- nếu cho phép `2 stop` thì lấy thêm 2-stop

Sau đó gom tất cả lại rồi sort theo lựa chọn của user.

### Phần 1-stop đã được dọn

Flow hiện tại của 1-stop dễ hiểu hơn:
- query tất cả first legs từ điểm đi
- lấy danh sách airport trung gian
- query second leg theo từng airport trung gian
- ghép lại nếu layover hợp lệ

Tức là bây giờ logic đi theo hướng build dữ liệu thực sự cần dùng, thay vì để các đoạn query placeholder hoặc query thừa làm nhiễu.

### Roundtrip đang build như nào?

Nếu có `return_date`:
- outbound one-way options được reuse
- return options được query riêng
- sau đó service mới cross-product để tạo `roundtrip_combinations`

Đồng thời đang có giới hạn số lượng option trước khi ghép để tránh nổ quá nhiều tổ hợp. Đây là kiểu fix thực dụng, không fancy nhưng rất cần vì roundtrip combo tăng số lượng rất nhanh.

### Ranking đang ưu tiên điều gì?

Hiện tại có 3 cách sort:
- `price`: rẻ nhất lên trước
- `duration`: tổng thời gian ngắn nhất lên trước
- `recommended`: qua hàm chấm điểm riêng

Với `recommended`, score hiện đang dựa trên mấy yếu tố chính:
- tổng giá
- tổng duration
- tổng layover
- bonus/penalty nhẹ theo cấu trúc airline và độ hợp lệ của layover

Nói đơn giản: service đang cố cân bằng giữa **rẻ**, **đỡ lâu**, và **không quá bất tiện** chứ không chỉ sort một chiều theo giá.

### Ý chính cần nhớ về flight combo

- Đã hỗ trợ direct, 1-stop, 2-stop, roundtrip
- Validation đầu vào tốt hơn
- Combo price đã đi cùng season pricing
- Flow query 1-stop và roundtrip rõ ràng hơn
- Ranking có consistency hơn thay vì chỉ sort sơ sài

---

## 3. Season: hiện tại đã có override, holiday, season nhưng chưa phải custom engine hoàn chỉnh cho admin

Phần season hiện giờ đã rõ về thứ tự ưu tiên và cách hệ thống quyết định multiplier cho một ngày bay.

### Thứ tự ưu tiên hiện tại

Service đang resolve theo đúng thứ tự này:

```text
override -> holiday -> season -> off-peak
```

Cụ thể:
1. **Override**: admin chỉnh tay theo một ngày cụ thể, priority cao nhất
2. **Holiday**: ngày lễ được định nghĩa riêng
3. **Season**: các mùa cao điểm theo period
4. Không match gì thì coi là off-peak, multiplier = `1.0`

### `getSeasonInfo()` hiện trả về gì?

Nếu match được thì thường sẽ có các thông tin kiểu:
- `name`
- `multiplier`
- `reason`
- `type` (`override`, `holiday`, `season`)
- một số flag như `isPeak`, `isHoliday`, `isOverride`, `isApproaching`

Điểm này quan trọng vì cùng một nguồn season info đang được tái sử dụng cho:
- pricing
- `season_info` trong flight search / combo search
- `price_alert`

### Override chính là phần “custom” gần nhất hiện có

Nếu hỏi admin hiện custom được đến đâu thì câu trả lời thực tế là:
- custom mạnh nhất đang nằm ở `price_overrides`
- đây là dạng chỉnh multiplier cho **một ngày cụ thể**
- và nó có priority cao hơn holiday/season

Còn `season_periods` thì vẫn là logic theo khoảng thời gian đã định nghĩa sẵn. Tức là admin có thể quản trị dữ liệu season, nhưng chưa phải kiểu rule engine quá linh hoạt.

### Mùa hiện tại đang dùng để làm gì?

Chủ yếu là:
- tăng / giảm giá theo mùa
- trả `season_info` cho phía client
- hỗ trợ `price_alert`
- phân biệt high season, holiday, approaching peak

Nói cách khác, season hiện tại phục vụ khá tốt cho pricing và messaging, nhưng chưa phải framework custom toàn diện cho admin kiểu muốn target theo route, airline, campaign hay condition phức tạp.

### Ý chính cần nhớ về season

- Hệ thống đã có priority rõ: `override > holiday > season > normal`
- Có admin override theo ngày cụ thể
- Có season info thống nhất để feed cho pricing, combo và alert
- Chưa có “admin custom season engine” đầy đủ, mới dừng ở mức cấu hình theo ngày lễ / mùa / override ngày cụ thể

---

## 4. Bonus note: lỗi runtime vừa gặp lúc dev

Trong lúc chạy local có 2 lỗi thực tế đã lòi ra:

### Lỗi 1: `ALERT_THRESHOLD_PERCENT is not defined`
Nguyên nhân là `price-alert.service.js` bị thiếu constant đầu file.

Đã fix bằng cách khôi phục:
- import pricing helpers
- constant `ALERT_THRESHOLD_PERCENT = 5`

### Lỗi 2: `EADDRINUSE: port 3000`
Lỗi này không phải bug business logic, chỉ là cổng `3000` đang bị process khác chiếm.

---

## 5. Chốt nhanh cho người đọc sau

Nếu cần nhớ ngắn gọn những gì vừa đổi thì có thể hiểu như này:

- **Date change**: đã tách luồng rõ ràng hơn, có OTP, có nhánh thanh toán riêng khi đổi sang chuyến đắt hơn.
- **Flight combo**: đã sạch hơn ở validation, flow query, ranking, và giá combo giờ có ăn theo season.
- **Season**: đã có thứ tự ưu tiên rõ ràng giữa override, holiday và season; đủ dùng cho pricing hiện tại nhưng chưa phải custom framework full cho admin.

Nếu sau này cần viết lại thành tài liệu chính thức cho team hoặc cho BA/QA, nên tách file này thành 3 doc riêng: `date-change`, `flight-combo`, `season-pricing` để dễ maintain hơn.