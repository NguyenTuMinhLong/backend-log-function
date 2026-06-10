# README ghi chú thay đổi gần đây

File này là bản note nội bộ, viết theo kiểu dễ đọc để ai vào sau cũng hiểu nhanh là hệ thống vừa được cập nhật gì, tại sao cập nhật, và hành vi hiện tại đang như thế nào.

---

## 1. Date change: V1 đã chốt theo hướng gọn, rõ trạng thái và không làm quá tay

Phần date change hiện tại nên hiểu là **V1 đã đủ dùng** và đã được dọn lại để tránh ôm thêm logic/admin payload không cần thiết. Mục tiêu của đợt này không phải mở rộng feature, mà là chốt một flow đổi ngày bay rõ ràng, kiểm soát được trạng thái, và đủ cho user + admin vận hành.

### Phạm vi V1 hiện tại

V1 hiện chỉ support **đổi ngày cho `outbound` leg**.

Điểm quan trọng:
- đã có `flight_leg` để định danh leg đang đổi
- current allowed value cho V1 là `outbound`
- uniqueness active request được tính **theo từng leg**, không còn theo cả booking kiểu quá rộng

Nói ngắn gọn: V1 này đã chuẩn bị cấu trúc đúng để sau này mở rộng, nhưng **hiện tại chỉ chốt outbound-only** chứ chưa làm return-leg flow.

### Flow đang chạy

**Bước 1: user tạo yêu cầu đổi ngày**
- Endpoint: `POST /api/date-changes/bookings/:bookingCode/change-flight`
- Input chính: `new_flight_id`, `new_seat_class`, `reason`, `flight_leg` (V1 hiện chỉ nhận `outbound`)
- Hệ thống sẽ:
  - check booking có hợp lệ không
  - check booking đang ở trạng thái `confirmed`
  - check user có quyền với booking đó không
  - check leg có được phép đổi không
  - check đã có request active cho đúng `flight_leg` này chưa
  - check chuyến mới và hạng ghế mới có hợp lệ không
  - tính chênh lệch giá theo phần vé đang đổi
  - tạo request với status `pending_otp`
  - gửi OTP về email booking

**Bước 2: user xác thực OTP**
- Endpoint: `POST /api/date-changes/confirm`
- Input: `email`, `otp`, `requestCode`
- Sau khi OTP đúng, hệ thống chia flow như sau:
  - nếu `price_difference > 0` và config yêu cầu thu thêm tiền thì chuyển sang `pending_payment`
  - nếu không cần thu thêm thì chuyển sang `pending`

Điểm quan trọng của V1 mới:
- **không auto approve ngay sau OTP**
- OTP chỉ là bước xác nhận request hợp lệ để đi tiếp vào flow xử lý chính thức

### Cách tính chênh lệch giá hiện tại

Hiện tại service đang so sánh phần **giá vé của leg đang đổi theo số ghế cần xử lý**, thay vì lấy cả `booking.total_price` để trừ.

Công thức đang dùng về bản chất là:

```javascript
newTotalPrice = newFlight.base_price * seatsNeeded;
oldPrice = booking.base_price * seatsNeeded;
priceDifference = newTotalPrice - oldPrice;
```

Ý nghĩa của cách này:
- chỉ so sánh phần vé đổi thực tế
- không trộn baggage / ancillary / chiều chưa đổi
- phù hợp hơn với rule của V1 outbound-only

### Sau khi OTP đúng thì đi nhánh nào?

#### Trường hợp 1: `price_difference > 0`
Khách phải trả thêm.

Hệ thống sẽ:
- update request sang `pending_payment`
- trả về `requires_payment: true`
- chờ user tạo payment riêng cho khoản chênh lệch

Endpoint tiếp theo:
- `POST /api/date-changes/:requestCode/payment`
- `GET /api/date-changes/:requestCode/payment`
- `DELETE /api/date-changes/:requestCode/payment`

#### Trường hợp 2: `price_difference <= 0`
Hệ thống sẽ:
- update request sang `pending`
- trả về `requires_payment: false`
- chờ admin xử lý

Điểm cần nhớ ở đây là:
- **V1 hiện tại không còn nhánh auto approve sau OTP**
- kể cả không cần trả thêm thì request vẫn vào hàng chờ xử lý chính thức

### Payment cho date change đã tách riêng

Phần thanh toán phụ phí đổi ngày có flow riêng, không dùng chung với payment booking gốc.

Hiện service đã xử lý:
- chỉ cho tạo payment khi request đang ở `pending_payment`
- không cho tạo payment nếu request không cần trả thêm
- lock request để tránh race condition
- có thể reuse payment cũ nếu payment đó vẫn còn hiệu lực và chưa terminal
- sau khi payment được xác nhận thành công thì service set payment `SUCCESS`, đưa request về `pending`, rồi gọi flow approve thực tế để đổi ghế/chuyến

Các method hiện support theo config:
- `BANK_QR`
- `MOMO`
- `PAYPAL`

Với nhánh `PAYPAL`:
- `POST /api/date-changes/:requestCode/payment` với `payment_method = "PAYPAL"` sẽ tạo payment code dạng `PAY-DC-*`
- service gọi provider PayPal để tạo order
- response payment sẽ mang theo `gateway_response` / instruction để frontend redirect user sang PayPal checkout
- nếu payment PayPal cũ còn pending và vẫn còn checkout URL hợp lệ thì service có thể reuse thay vì tạo payment mới

### Nếu khách phải trả thêm thì flow hiện tại đi như nào?

Đây là nhánh quan trọng nhất của date change V1 khi chuyến mới đắt hơn.

Flow thực tế:
1. User tạo request đổi ngày → request được tạo với `status = pending_otp`
2. System trả về `price_difference`
3. User verify OTP qua `POST /api/date-changes/confirm`
4. Nếu `price_difference > 0` và config `chargeIfPositive` bật, request chuyển sang `pending_payment`
5. User gọi `POST /api/date-changes/:requestCode/payment` với `payment_method = "PAYPAL"`
6. Khi payment được xác nhận thành công, request được đẩy về `pending`
7. Sau đó flow approve thực tế sẽ đổi ghế/chuyến và hoàn tất cập nhật booking

Điểm cần nhớ:
- nhánh này là **thu thêm trước rồi mới hoàn tất đổi chuyến**
- request không nhảy thẳng sang `approved` ngay sau OTP
- payment thành công là điều kiện để request quay lại hàng chờ xử lý tiếp

### Nếu khách được hoàn tiền thì tiền được xử lý lúc nào?

Đây là phần dễ hiểu nhầm nhất nếu chỉ nhìn `price_difference` ở lúc tạo request.

Hiện logic refund của date change **không phải** là cứ `price_difference < 0` thì lập tức tạo refund ngay sau OTP.

Thực tế flow đang là:
- sau OTP, nếu không cần thu thêm thì request đi vào `pending`
- đến lúc `approveDateChange` chạy thật, service mới:
  - release ghế cũ
  - reserve ghế mới
  - hủy ancillary outbound không còn phù hợp (trừ insurance)
  - cập nhật lại `booking.total_price`
  - tính phần hoàn thực tế

Công thức refund thực tế ở bước approve đang là:
- `ticketRefund = max(0, -ticketDiff)`
- `refundableAmount = ticketRefund + cancelledAncillaryTotal`

Tức là khoản hoàn có thể đến từ 2 nguồn:
1. **chênh lệch vé giảm** nếu chuyến mới rẻ hơn chuyến cũ
2. **dịch vụ outbound bị hủy** do đổi chuyến, ví dụ baggage/ancillary không còn áp dụng nữa

Nếu `refundableAmount > 0` thì system sẽ:
- auto tạo một record trong bảng `refunds`
- gắn `refund_type = partial_leg`
- link refund đó vào `date_change_requests.related_refund_id`
- để `status = pending` cho refund này

Nói ngắn gọn:
- **thu thêm** được xử lý ở nhánh payment trước khi hoàn tất đổi chuyến
- **hoàn tiền** chỉ được quyết toán sau khi approve đổi chuyến và sau khi biết chính xác ticket diff + ancillary bị hủy

### Có trường hợp vừa đổi chuyến vừa phát sinh refund không?

Có.

Ví dụ thực tế:
- vé chuyến mới đắt hơn ở phần ticket
- nhưng khi approve thì outbound ancillary bị hủy tạo ra một khoản hoàn
- hoặc vé mới rẻ hơn và lại còn có ancillary bị hủy

Lúc đó system sẽ tính trên tổng thực tế sau approve:
- nếu có khoản hoàn dương thì tạo refund record
- nếu phần vé tăng sau khi trừ ancillary vẫn còn dương thì admin notes có thể được ghi thêm thông tin phụ thu

Code hiện tại còn có bước ghi note nội bộ kiểu:
- `PHỤ THU: ... VND chưa thu từ khách`

Điều này cho thấy approve flow đang cố phản ánh **net effect cuối cùng** của việc đổi ngày, chứ không chỉ nhìn duy nhất vào một con số ở bước request ban đầu.

### Admin flow trong V1

Admin hiện chỉ cần làm đúng phần cốt lõi:
- xem danh sách request đang chờ xử lý
- xem chi tiết request
- approve / reject request

Để giữ V1 gọn, phần response admin đã được trim lại:
- vẫn giữ `payment_status` để admin biết request đã thanh toán hay chưa
- bỏ `queue_summary`
- bỏ `approved_change_count` khỏi các query trả dữ liệu admin/detail
- pending list chỉ giữ các field đủ dùng cho vòng xử lý cơ bản

### Ý chính cần nhớ về date change V1

- V1 hiện tại **đã đủ** và nên freeze scope tại đây
- Chỉ support `outbound` leg
- Có OTP bắt buộc
- Có tách nhánh `pending_payment` riêng khi khách phải bù tiền
- Payment success chỉ chuyển request về `pending`, chưa approve
- Admin là bước duyệt cuối
- Schema và unique index đã được chỉnh theo `flight_leg`
- Phần payload/admin response đã được dọn bớt cho gọn V1

### Những gì chưa làm trong V1 và nên để sau

Các phần dưới đây không nên nhét thêm vào V1 nữa:
- return-leg date change
- auto-approve phức tạp
- analytics/reporting cho admin
- mở rộng thêm field response nếu frontend chưa thực sự cần
- các phần polish không ảnh hưởng đến correctness của flow

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

## 3. Season: logic hiện tại đã thành một flow pricing khá đầy đủ, có cache, holiday rules âm lịch và override theo ngày

Phần season hiện tại không còn chỉ là mấy mốc mùa cao điểm đơn giản nữa. Logic thực tế bây giờ là một flow resolve thống nhất để backend quyết định **một ngày bay cụ thể** đang thuộc diện nào, lấy multiplier bao nhiêu, và trả metadata gì ra cho client.

Điểm quan trọng nhất là toàn bộ hệ thống đang cố dùng **một nguồn season info chung** cho pricing, search, combo, detail và price alert để tránh mỗi nơi tính một kiểu.

### Thứ tự ưu tiên hiện tại

Service đang resolve theo đúng thứ tự này:

```text
override -> holiday_rules -> holidays -> season -> normal(1.0)
```

Cụ thể:
1. **Override**: admin chỉnh tay cho đúng một ngày cụ thể trong `price_overrides`, priority cao nhất
2. **Holiday rule**: rule động trong `holiday_rules`, có thể resolve theo solar hoặc lunar calendar
3. **Holiday cố định**: dữ liệu trong bảng `holidays`
4. **Season period**: dữ liệu trong `season_periods`
5. Không match gì thì coi là normal/off-peak, multiplier = `1.0`

Điểm này quan trọng vì nếu đã có override thì holiday/season phía dưới **không còn tác dụng** cho ngày đó nữa.

### Các nguồn dữ liệu season hiện đang dùng

Hiện tại season service đang đọc từ 4 nguồn dữ liệu chính:
- `season_periods`: mùa cao điểm theo khoảng ngày-tháng
- `holidays`: ngày lễ kiểu fixed-date hoặc date có year cụ thể
- `holiday_rules`: rule lễ động, có thể resolve theo năm
- `price_overrides`: override một ngày cụ thể do admin tạo

Nói ngắn gọn:
- `season_periods` giải quyết bài toán “mùa”
- `holidays` giải quyết bài toán “ngày lễ tĩnh”
- `holiday_rules` giải quyết bài toán “ngày lễ động”, đặc biệt hữu ích cho Tết âm lịch
- `price_overrides` là lớp manual control mạnh nhất hiện tại

### Holiday rules là phần mới quan trọng nhất

Đây là chỗ season logic hiện tại đã tiến hơn bản cũ khá nhiều.

`holiday_rules` cho phép backend định nghĩa một ngày lễ theo rule thay vì phải seed thủ công từng ngày cho từng năm.

Hiện service support:
- `calendar_type = solar`
- `calendar_type = lunar`
- `offset_days` để dịch trước/sau ngày anchor
- `priority` để xử lý khi nhiều rule rơi vào cùng một ngày
- `group_key` để gom nhóm cùng một dịp lễ nếu cần dùng ở tầng trên

Ý nghĩa thực tế:
- với lễ dương như 01/01 hoặc 30/04 thì có thể resolve trực tiếp theo solar
- với Tết âm lịch thì có thể resolve từ lịch âm sang ngày dương bằng `solarlunar`
- nếu cần “cao điểm trước Tết 2 ngày” hay “sau lễ 1 ngày” thì dùng `offset_days`

Tức là nếu sau này muốn làm Tết đúng business logic thì hướng chuẩn hơn là seed `holiday_rules`, không phải hardcode trong code, cũng không phải mỗi năm lại nhập tay toàn bộ ngày lễ vào `holidays`.

### Season period hiện đang match như nào?

`season_periods` hiện không bị giới hạn ở các khoảng nằm gọn trong một năm dương lịch. Service đã support cả season **cross-year**.

Ví dụ kiểu:
- bắt đầu tháng 12 năm nay
- kết thúc tháng 1 năm sau

thì vẫn match đúng.

Cách làm hiện tại là service build season window theo `referenceYear - 1` và `referenceYear`, rồi check xem `departureDate` có nằm trong một trong các window đó không.

Điểm này giúp các mùa kiểu cuối năm - đầu năm hoạt động đúng mà không cần hack dữ liệu.

### Nếu có nhiều season cùng match thì chọn cái nào?

Nếu một ngày rơi vào nhiều season periods cùng lúc, hệ thống không lấy đại bản ghi đầu tiên.

Nó sẽ chọn theo rule:
1. `priority` cao hơn thắng
2. nếu `priority` bằng nhau thì `multiplier` cao hơn thắng

Nghĩa là admin/data layer có thể chồng season lên nhau, miễn là biết season nào cần priority cao hơn.

### `getSeasonInfo()` hiện trả về gì?

`getSeasonInfo(departureDate)` là hàm trung tâm của toàn bộ flow.

Nếu match được override / holiday / season thì response thường có các thông tin như:
- `name`
- `multiplier`
- `reason`
- `type` (`override`, `holiday`, `season`)
- `daysUntil`
- các flag như `isPeak`, `isHoliday`, `isOverride`, `isApproaching`, `isInside`

Ngoài ra còn có metadata phụ thuộc loại match:
- holiday từ rule có thể có thêm `calendar_type`, `rule_type`, `group_key`
- season có thể có `approachingInfo`

Nếu không match gì thì `getSeasonInfo()` trả `null`.

Điểm này dẫn tới một rule rất thực dụng ở tầng pricing:
- có info thì lấy `info.multiplier`
- không có info thì mặc định `1.0`

### `isPeak`, `isHoliday`, `isOverride` hiện nên hiểu như nào?

- `isOverride`: ngày đó đang bị override tay bởi admin
- `isHoliday`: ngày đó match holiday hoặc holiday rule
- `isPeak`: hiện đang hiểu khá thực dụng là multiplier đủ cao để coi là peak, hoặc holiday thì luôn được coi là peak

Cụ thể:
- với override: `isPeak = multiplier >= 1.20`
- với season: `isPeak = multiplier >= 1.20`
- với holiday/rule holiday: service đang trả `isPeak = true`

Tức là holiday đang được coi là một dạng peak day về mặt messaging/pricing context.

### `isApproachingPeakSeason()` đang làm gì?

Đây là phần README cũ chưa nói rõ.

Service hiện có thêm khái niệm **approaching peak season** để phục vụ alert/messaging.

Logic này:
- default threshold là `30` ngày
- nếu ngày bay đang nằm trong season thì trả `isApproaching: true` và `isInside: true`
- nếu hiện tại đang ở gần ngày bắt đầu một season sắp tới, và ngày bay nằm từ điểm season bắt đầu trở đi, service có thể trả trạng thái “sắp vào mùa cao điểm”

Khi match season thường, `getSeasonInfo()` có thể đính kèm:
- `isApproaching`
- `isInside`
- `approachingInfo.reason`
- `approachingInfo.daysUntilSeasonStart`

Điểm quan trọng: đây không phải một loại `type` riêng, mà là metadata bổ sung quanh một season match.

### Cache của season service hiện tại

Season service hiện đã có cache trong memory để giảm query DB lặp lại:
- `seasonCache`
- `holidayCache`
- `holidayRuleCache`
- `overrideCache`

TTL hiện tại là khoảng `1 giờ`.

Ý nghĩa thực tế:
- search flight nhiều lần sẽ không phải query full season tables liên tục
- override theo ngày cũng có cache riêng theo `dateStr`
- khi admin tạo/sửa/xóa override thì controller có gọi clear cache override để tránh stale data quá lâu
- service cũng có `refreshCache()` để clear toàn bộ cache season/holiday/rule/override

Nói đơn giản: logic này thiên về performance đủ dùng chứ chưa phải distributed cache phức tạp.

### Override hiện custom được tới đâu?

Nếu hỏi admin hiện “custom season” được gì thì câu trả lời thực tế là:
- custom mạnh nhất đang nằm ở `price_overrides`
- admin có thể set multiplier cho **một ngày cụ thể**
- override này thắng toàn bộ holiday/season bên dưới
- create/update/delete override đều có clear override cache

Đây chính là cơ chế phù hợp nhất cho các case test nhanh, hotfix pricing, hoặc dịp đặc biệt chưa kịp seed rule chính thức.

Nhưng cũng cần nói rõ là:
- override hiện chỉ target theo **date**
- chưa target theo route, airline, cabin, campaign hay segmentation nâng cao

Tức là đây là custom control hữu ích, nhưng chưa phải pricing rule engine tổng quát.

### Season logic hiện đang đi vào pricing như nào?

Flow hiện tại về bản chất là:
1. lấy `seasonInfo` hoặc `seasonMultiplier`
2. đưa multiplier đó vào dynamic pricing chung
3. trả kết quả giá cuối cùng + metadata season cho client

Với `flight.service`:
- `getSeasonMultiplier(departureTime)` được đưa vào `applyDynamicPricing(...)`
- `formatFlights(...)` đồng thời gắn luôn `season_info` vào từng flight
- `seat.base_price`, `price_breakdown`, `seat.total_price` đều đã phản ánh multiplier mùa tương ứng

Với `flight-combo.service`:
- mỗi leg trong combo cũng có `season_info`
- combo pricing hiện đã đi cùng season logic, không còn là nhánh giá tách rời

Nói ngắn gọn: season bây giờ không chỉ để “ghi chú là đang mùa cao điểm”, mà thực sự đã đi vào số tiền trả ra.

### Season info hiện đang được trả ra ở đâu?

Hiện season metadata đang được dùng lại ở nhiều chỗ:
- `GET /api/flights/search`
- `GET /api/flights/combo`
- các response flight detail
- `GET /api/flights/:id/price-analysis`
- `price_alert` / detailed analysis

Điểm tốt của kiến trúc hiện tại là client không phải tự đoán mùa từ ngày bay. Backend đã resolve sẵn và trả `season_info` cùng dữ liệu giá.

### Price alert hiện đang phụ thuộc vào season ra sao?

`price-alert.service` cũng reuse season service thay vì tự tính riêng.

Hiện alert logic dùng season theo mấy cách chính:
- lấy `seasonMultiplier` để tính breakdown giá
- lấy `seasonInfo` để build message/recommendation
- dùng `shouldAlert(departureDate)` để quyết định có nên alert mạnh không

Rule trong `shouldAlert()` hiện là:
- alert nếu là holiday
- hoặc là peak
- hoặc là approaching peak với `multiplier >= 1.15`

Nghĩa là season không chỉ ảnh hưởng giá, mà còn ảnh hưởng cả cách backend giải thích cho người dùng rằng giá đang cao vì sao.

### Tết hiện tại nên hiểu đúng như nào?

Đây là phần rất dễ hiểu nhầm nếu chỉ nhìn README cũ.

Hiện code **đã có khả năng support Tết âm lịch** thông qua `holiday_rules` + `calendar_type = lunar` + thư viện `solarlunar`.

Nhưng khả năng support trong code **không đồng nghĩa** với việc môi trường hiện tại chắc chắn đã có dữ liệu Tết trong DB.

Nên cần tách 2 ý:
- **về code**: đã hỗ trợ resolve Tết âm lịch
- **về dữ liệu DB**: có thể vẫn chưa seed `holiday_rules` hoặc `holidays` cho Tết

Vì vậy nếu DB chưa có dữ liệu Tết thì cách test nhanh hợp lý nhất vẫn là dùng `price_overrides` để mô phỏng.

### Ý chính cần nhớ về season hiện tại

- Hệ thống không còn chỉ có `override > holiday > season`, mà thực tế là `override > holiday_rules > holidays > season > normal`
- Có support holiday rule theo **solar và lunar calendar**
- Có support season cross-year
- Có cơ chế chọn season theo `priority`, rồi fallback theo `multiplier`
- Có cache in-memory khoảng 1 giờ cho season/holiday/rule/override
- `getSeasonInfo()` là nguồn dữ liệu trung tâm cho pricing, search, combo, detail và alert
- `price_overrides` là công cụ custom/manual mạnh nhất hiện tại
- Đã support Tết ở tầng code nếu DB có `holiday_rules` đúng, nhưng không đảm bảo mọi môi trường đã có dữ liệu đó
- Chưa phải custom pricing engine đầy đủ theo route/airline/campaign/segment

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