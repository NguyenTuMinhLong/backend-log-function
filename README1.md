IVUDEE REWARDS - Membership & Loyalty System
Hệ thống Chương trình Khách hàng Thân thiết cho dự án Flight Booking.
Tính năng đã hoàn thành

Tự động tạo membership khi user chưa có
Tích điểm tự động sau khi đặt vé thành công
Hệ thống tier (Member → Silver → Gold → Platinum)
Multiplier điểm theo tier
Lịch sử giao dịch điểm (loyalty_transactions)
API xem thông tin membership
Route test nhanh


1. Database Schema (đã chạy)
Các bảng:

loyalty_tiers – Định nghĩa các cấp bậc
user_loyalty – Thông tin membership của user
loyalty_transactions – Lịch sử tích/đổi điểm

Đã seed sẵn 4 tier:

Member (0 điểm, multiplier 1.0)
Silver (15.000 điểm, multiplier 1.25)
Gold (40.000 điểm, multiplier 1.50)
Platinum (80.000 điểm, multiplier 1.75)


2. Cấu trúc file module
textsrc/
├── queries/
│   └── loyalty.queries.js
├── services/
│   └── loyalty.service.js
├── controllers/
│   └── loyalty.controller.js
├── routes/
│   └── loyalty.routes.js
└── services/
    └── booking.service.js          ← đã hook loyalty

3. Cách sử dụng
API chính

GET /api/loyalty/me → Xem thông tin membership của user đang đăng nhập
GET /api/loyalty/me?userId=8 → Test (truyền userId)

Test nhanh tích điểm
textGET http://localhost:3000/api/loyalty/test-earn?userId=8&totalPrice=1200000

4. Hook tự động tích điểm
Đã hook trong src/services/booking.service.js (trong hàm createBooking):
JavaScriptif (userId) {
  await loyaltyService.earnPointsAfterBooking(userId, booking.id, totalPrice);
}
Cách tính điểm:

10.000 VNĐ = 1 điểm cơ bản
Nhân thêm multiplier theo tier

Ví dụ: vé 1.200.000 VNĐ ở tier Gold (1.5x) → được 180 điểm

5. Các file đã tạo / sửa (tóm tắt)


FileMục đíchTrạng tháiloyalty.queries.jsTất cả SQL queriesHoàn thànhloyalty.service.jsLogic business (tạo membership, tích điểm)Hoàn thànhloyalty.controller.jsController APIHoàn thànhloyalty.routes.jsĐịnh nghĩa route + route testHoàn thànhbooking.service.jsHook earnPointsAfterBookingĐã thêmDatabase tablesloyalty_tiers, user_loyalty, loyalty_transactionsĐã tạo

6. Lưu ý quan trọng

Chỉ tích điểm khi user đã đăng nhập (userId tồn tại)
booking_id trong transaction có thể là null (test) hoặc ID thật
Điểm chỉ tăng khi booking thành công (sau COMMIT)
Có console log rõ ràng để debug ([Loyalty], [TEST])

Mình ghi nhận rõ vấn đề bạn đang gặp:
🔴 Điểm còn thiếu (cho lần làm tiếp theo):
Tính năng "Auto Upgrade Tier" chưa có

Điểm đã tích đủ để lên tier mới (ví dụ đủ 15.000 điểm lên Silver).
Nhưng tier_id trong bảng user_loyalty vẫn chưa được cập nhật.
Khi gọi /loyalty/me vẫn hiển thị tier cũ ("Member").

Đây là logic tự động nâng hạng (Tier Progression) mà chúng ta chưa implement.

Code bổ sung cho lần sau (copy-paste sẵn)
Mở file src/services/loyalty.service.js, thay hàm earnPointsAfterBooking bằng phiên bản mới sau (đã thêm auto upgrade):
JavaScript/**
 * TÍCH ĐIỂM + TỰ ĐỘNG NÂNG TIER (đã fix)
 */
exports.earnPointsAfterBooking = async (userId, bookingId, totalPrice) => {
  let membership = await exports.getMembershipInfo(userId);

  const basePoints = Math.floor(totalPrice / 10000);
  const pointsEarned = Math.floor(basePoints * membership.multiplier);

  // 1. Cập nhật điểm
  await db.query(queries.UPDATE_POINTS, [userId, pointsEarned]);

  // 2. Ghi lịch sử
  await db.query(queries.INSERT_TRANSACTION, [
    userId,
    bookingId,
    'earn',
    pointsEarned,
    `Tích điểm từ booking #${bookingId} (${totalPrice} VNĐ)`
  ]);

  // 3. KIỂM TRA VÀ NÂNG TIER TỰ ĐỘNG
  await upgradeTierIfEligible(userId);

  console.log(`[Loyalty] User ${userId} tích ${pointsEarned} điểm từ booking ${bookingId}`);

  return { pointsEarned };
};

/** Hàm mới: Tự động nâng tier nếu đủ điều kiện */
const upgradeTierIfEligible = async (userId) => {
  const result = await db.query(`
    SELECT ul.total_points, lt.name as current_tier, lt.min_points
    FROM user_loyalty ul
    JOIN loyalty_tiers lt ON ul.tier_id = lt.id
    WHERE ul.user_id = $1
  `, [userId]);

  if (result.rows.length === 0) return;

  const { total_points, current_tier } = result.rows[0];

  // Tìm tier cao hơn phù hợp
  const nextTierResult = await db.query(`
    SELECT id, name 
    FROM loyalty_tiers 
    WHERE min_points <= $1 
      AND name != $2
    ORDER BY min_points DESC 
    LIMIT 1
  `, [total_points, current_tier]);

  if (nextTierResult.rows.length === 0) return;

  const newTier = nextTierResult.rows[0];

  // Nếu tier mới khác tier hiện tại → nâng cấp
  if (newTier.name !== current_tier) {
    await db.query(`
      UPDATE user_loyalty 
      SET tier_id = $1, updated_at = NOW()
      WHERE user_id = $2
    `, [newTier.id, userId]);

    console.log(`[Loyalty] 🎉 User ${userId} đã được nâng tier: ${current_tier} → ${newTier.name}`);
  }
};