-- Migration: 025_create_price_overrides
-- Bảng cho phép admin tùy chỉnh giá theo ngày cụ thể (override hoàn toàn season/holiday logic)

-- Price Overrides - cho phép admin set giá custom cho ngày bất kỳ
CREATE TABLE IF NOT EXISTS price_overrides (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    multiplier DECIMAL(4,2) NOT NULL CHECK (multiplier > 0),
    reason VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Mỗi ngày chỉ có 1 override active
CREATE UNIQUE INDEX IF NOT EXISTS idx_price_overrides_date_active 
    ON price_overrides(date) WHERE is_active = true;

-- Index cho truy vấn nhanh theo ngày
CREATE INDEX IF NOT EXISTS idx_price_overrides_date ON price_overrides(date);

-- Comment
COMMENT ON TABLE price_overrides IS 'Admin override giá cho ngày cụ thể. Override > Holiday > Season.';
COMMENT ON COLUMN price_overrides.multiplier IS 'Hệ số nhân. VD: 1.50 = tăng 50%, 0.80 = giảm 20%';
