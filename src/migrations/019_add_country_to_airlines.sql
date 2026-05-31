-- Migration 019: Thêm country vào airlines để lọc route hợp lệ
ALTER TABLE airlines ADD COLUMN IF NOT EXISTS country VARCHAR(100);

UPDATE airlines SET country = CASE UPPER(code)
  -- Việt Nam
  WHEN 'VN' THEN 'Vietnam'  WHEN 'QH' THEN 'Vietnam'
  WHEN 'VJ' THEN 'Vietnam'  WHEN 'BL' THEN 'Vietnam'  WHEN 'VU' THEN 'Vietnam'
  -- Thái Lan
  WHEN 'TG' THEN 'Thailand' WHEN 'WE' THEN 'Thailand' WHEN 'DD' THEN 'Thailand'
  WHEN 'SL' THEN 'Thailand' WHEN 'FD' THEN 'Thailand' WHEN 'PG' THEN 'Thailand'
  -- Singapore
  WHEN 'SQ' THEN 'Singapore' WHEN 'TR' THEN 'Singapore' WHEN '3K' THEN 'Singapore'
  WHEN 'MI' THEN 'Singapore'
  -- Malaysia
  WHEN 'MH' THEN 'Malaysia'  WHEN 'AK' THEN 'Malaysia'  WHEN 'OD' THEN 'Malaysia'
  WHEN 'D7' THEN 'Malaysia'
  -- Indonesia
  WHEN 'GA' THEN 'Indonesia' WHEN 'JT' THEN 'Indonesia' WHEN 'ID' THEN 'Indonesia'
  WHEN 'QZ' THEN 'Indonesia'
  -- Philippines
  WHEN 'PR' THEN 'Philippines' WHEN 'Z2' THEN 'Philippines'
  -- Brunei
  WHEN 'BI' THEN 'Brunei'
  -- Lào
  WHEN 'QV' THEN 'Laos' WHEN 'LJ' THEN 'Laos'
  -- Campuchia
  WHEN 'K6' THEN 'Cambodia'
  -- Hàn Quốc
  WHEN 'KE' THEN 'South Korea' WHEN 'OZ' THEN 'South Korea'
  WHEN '7C' THEN 'South Korea' WHEN 'RS' THEN 'South Korea'
  WHEN 'TW' THEN 'South Korea' WHEN 'BX' THEN 'South Korea'
  -- Nhật Bản
  WHEN 'JL' THEN 'Japan' WHEN 'NH' THEN 'Japan'
  WHEN 'MM' THEN 'Japan' WHEN 'GK' THEN 'Japan' WHEN 'BC' THEN 'Japan'
  -- Đài Loan
  WHEN 'CI' THEN 'Taiwan' WHEN 'BR' THEN 'Taiwan'
  WHEN 'JX' THEN 'Taiwan' WHEN 'IT' THEN 'Taiwan'
  -- Trung Quốc
  WHEN 'MU' THEN 'China' WHEN 'CA' THEN 'China' WHEN 'CZ' THEN 'China'
  WHEN 'HU' THEN 'China' WHEN 'HO' THEN 'China'
  WHEN 'FM' THEN 'China' WHEN 'MF' THEN 'China'
  -- Hong Kong
  WHEN 'CX' THEN 'Hong Kong'
  -- Qatar
  WHEN 'QR' THEN 'Qatar'
  -- UAE
  WHEN 'EK' THEN 'UAE' WHEN 'EY' THEN 'UAE' WHEN 'FZ' THEN 'UAE'
  -- Thổ Nhĩ Kỳ
  WHEN 'TK' THEN 'Turkey'
  -- Ả Rập Saudi
  WHEN 'SV' THEN 'Saudi Arabia'
  -- Bahrain
  WHEN 'GF' THEN 'Bahrain'
  -- Oman
  WHEN 'WY' THEN 'Oman'
  -- Anh
  WHEN 'BA' THEN 'United Kingdom' WHEN 'VS' THEN 'United Kingdom'
  WHEN 'U2' THEN 'United Kingdom'
  -- Đức
  WHEN 'LH' THEN 'Germany' WHEN 'EW' THEN 'Germany'
  -- Pháp
  WHEN 'AF' THEN 'France'
  -- Hà Lan
  WHEN 'KL' THEN 'Netherlands'
  -- Thụy Sĩ
  WHEN 'LX' THEN 'Switzerland'
  -- Đan Mạch/Scandinavia
  WHEN 'SK' THEN 'Denmark'
  -- Tây Ban Nha
  WHEN 'IB' THEN 'Spain' WHEN 'VY' THEN 'Spain'
  -- Áo
  WHEN 'OS' THEN 'Austria'
  -- Phần Lan
  WHEN 'AY' THEN 'Finland'
  -- Bỉ
  WHEN 'SN' THEN 'Belgium'
  -- Ý
  WHEN 'AZ' THEN 'Italy'
  -- Bồ Đào Nha
  WHEN 'TP' THEN 'Portugal'
  -- Ireland (Ryanair)
  WHEN 'FR' THEN 'Ireland'
  -- Hungary (Wizz Air)
  WHEN 'W6' THEN 'Hungary'
  -- Anh (EasyJet)
  WHEN 'U2' THEN 'United Kingdom'
  -- Na Uy
  WHEN 'DY' THEN 'Norway'
  -- Mỹ
  WHEN 'AA' THEN 'United States' WHEN 'UA' THEN 'United States'
  WHEN 'DL' THEN 'United States' WHEN 'AS' THEN 'United States'
  WHEN 'B6' THEN 'United States' WHEN 'NK' THEN 'United States'
  WHEN 'F9' THEN 'United States' WHEN 'WN' THEN 'United States'
  -- Canada
  WHEN 'AC' THEN 'Canada' WHEN 'WS' THEN 'Canada'
  -- Úc
  WHEN 'QF' THEN 'Australia' WHEN 'VA' THEN 'Australia' WHEN 'JQ' THEN 'Australia'
  -- New Zealand
  WHEN 'NZ' THEN 'New Zealand'
  -- Ấn Độ
  WHEN 'AI' THEN 'India' WHEN 'UK' THEN 'India' WHEN '6E' THEN 'India'
  -- Ethiopia
  WHEN 'ET' THEN 'Ethiopia'
  -- Chile (LATAM)
  WHEN 'LA' THEN 'Chile'
  ELSE NULL
END
WHERE country IS NULL;
