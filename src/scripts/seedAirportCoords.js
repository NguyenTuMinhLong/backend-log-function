/**
 * Script tự động lấy tọa độ sân bay từ Nominatim (OpenStreetMap)
 * Chạy 1 lần duy nhất: node src/scripts/seedAirportCoords.js
 *
 * Cách hoạt động:
 * 1. Đọc tất cả airports trong DB còn thiếu lat/lng
 * 2. Với mỗi airport → gọi Nominatim API theo tên + thành phố
 * 3. Lưu lat/lng vào DB
 */

require("dotenv").config();
const pool = require("../config/db");

// ── Nominatim API ─────────────────────────────────────────
// Quy tắc: delay 1 giây giữa mỗi request (Nominatim yêu cầu)
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getCoords = async (airportName, city, country) => {
  // Thử tìm theo tên sân bay trước
  const queries = [
    `${airportName} airport`,        // "Noi Bai airport"
    `${city} airport ${country}`,    // "Hanoi airport Vietnam"
    `${city} ${country}`,            // "Hanoi Vietnam"
  ];

  for (const q of queries) {
    try {
      const url =
        `https://nominatim.openstreetmap.org/search` +
        `?q=${encodeURIComponent(q)}` +
        `&format=json&limit=1&addressdetails=0`;

      const res = await fetch(url, {
        headers: {
          // Nominatim yêu cầu User-Agent có tên app của bạn
          "User-Agent": "Vivudee/1.0 (daodungvan321@gmail.com)",
        },
      });

      const data = await res.json();

      if (data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        console.log(`"${q}" → lat=${lat}, lng=${lng}`);
        return { lat, lng };
      }
    } catch (err) {
      console.error(`Lỗi fetch: ${err.message}`);
    }

    // Delay 1s giữa mỗi query (bắt buộc theo Nominatim policy)
    await delay(1000);
  }

  return null; // Không tìm được
};

// ── Main ──────────────────────────────────────────────────
const run = async () => {
  console.log("Bắt đầu lấy tọa độ sân bay từ Nominatim...\n");

  // Thêm cột lat/lng nếu chưa có
  await pool.query(`
    ALTER TABLE airports
      ADD COLUMN IF NOT EXISTS lat DECIMAL(10, 7),
      ADD COLUMN IF NOT EXISTS lng DECIMAL(10, 7)
  `);

  // Lấy danh sách airports còn thiếu tọa độ
  const { rows: airports } = await pool.query(`
    SELECT id, code, name, city, country
    FROM airports
    WHERE lat IS NULL OR lng IS NULL
    ORDER BY id ASC
  `);

  if (airports.length === 0) {
    console.log("Tất cả sân bay đã có tọa độ rồi!");
    process.exit(0);
  }

  console.log(`Tìm thấy ${airports.length} sân bay chưa có tọa độ:\n`);

  let success = 0;
  let failed  = 0;

  for (const airport of airports) {
    console.log(`[${airport.code}] ${airport.name} — ${airport.city}, ${airport.country}`);

    const coords = await getCoords(airport.name, airport.city, airport.country);

    if (coords) {
      await pool.query(
        `UPDATE airports SET lat = $1, lng = $2 WHERE id = $3`,
        [coords.lat, coords.lng, airport.id]
      );
      success++;
    } else {
      console.log(`Không tìm được tọa độ — bỏ qua`);
      failed++;
    }

    // Delay 1.2s giữa mỗi airport (Nominatim policy: max 1 request/giây)
    await delay(1200);
  }

  console.log(`\nHoàn thành!`);
  console.log(`   Thành công: ${success} sân bay`);
  console.log(`   Thất bại:   ${failed} sân bay`);

  // In ra danh sách sân bay vẫn còn thiếu để xử lý thủ công
  if (failed > 0) {
    const { rows: missing } = await pool.query(`
      SELECT code, name, city FROM airports
      WHERE lat IS NULL OR lng IS NULL
    `);
    console.log("\n⚠ Sân bay chưa có tọa độ (cần nhập tay):");
    missing.forEach((a) => console.log(`   ${a.code} — ${a.name}, ${a.city}`));
  }

  process.exit(0);
};

run().catch((err) => { //hàm chạy
  console.error("Lỗi:", err.message);
  process.exit(1);
});