"use strict";

const pool = require("../config/db");
const Q    = require("../queries/price-rule.queries");

// ─── Core: tính giá điều chỉnh ────────────────────────────────────────────────

/**
 * Lấy tất cả rules áp dụng cho 1 chuyến bay cụ thể vào ngày cụ thể
 * Filter theo: ngày, hạng ghế, hãng, tuyến bay
 */
const getApplicableRules = async (date, { seatClass, airlineCode, departureCode, arrivalCode }) => {
  const result = await pool.query(Q.GET_ACTIVE_RULES_FOR_DATE, [date]);

  return result.rows.filter(rule => {
    // Lọc theo hạng ghế
    if (rule.applies_to_class && rule.applies_to_class !== seatClass) return false;
    // Lọc theo hãng
    if (rule.applies_to_airline_code && rule.applies_to_airline_code !== airlineCode) return false;
    // Lọc theo sân bay đi
    if (rule.applies_to_departure_code && rule.applies_to_departure_code !== departureCode) return false;
    // Lọc theo sân bay đến
    if (rule.applies_to_arrival_code && rule.applies_to_arrival_code !== arrivalCode) return false;
    return true;
  });
};

/**
 * Tính giá sau khi áp dụng tất cả rules (stacking)
 * Thứ tự: percent rules trước, fixed rules sau
 * Giá tối thiểu: 10% base_price (không để âm)
 */
const calcAdjustedPrice = (basePrice, rules) => {
  if (!rules || rules.length === 0) {
    return { adjusted_price: basePrice, discount: 0, applied_rules: [] };
  }

  let price = parseFloat(basePrice);
  const appliedRules = [];

  // 1. Áp dụng percent rules trước (theo priority cao → thấp)
  const percentRules = rules
    .filter(r => r.adjustment_type === 'percent')
    .sort((a, b) => b.priority - a.priority);

  for (const rule of percentRules) {
    const delta = Math.round(price * parseFloat(rule.adjustment_value) / 100);
    price += delta;
    appliedRules.push({
      id:         rule.id,
      name:       rule.name,
      type:       rule.type,
      adjustment: `${rule.adjustment_value > 0 ? '+' : ''}${rule.adjustment_value}%`,
      delta,
    });
  }

  // 2. Áp dụng fixed rules sau
  const fixedRules = rules
    .filter(r => r.adjustment_type === 'fixed')
    .sort((a, b) => b.priority - a.priority);

  for (const rule of fixedRules) {
    const delta = parseFloat(rule.adjustment_value);
    price += delta;
    appliedRules.push({
      id:         rule.id,
      name:       rule.name,
      type:       rule.type,
      adjustment: `${delta > 0 ? '+' : ''}${delta.toLocaleString('vi-VN')}đ`,
      delta,
    });
  }

  // Giá tối thiểu = 10% base_price
  const minPrice = Math.round(parseFloat(basePrice) * 0.1);
  const adjustedPrice = Math.max(Math.round(price), minPrice);
  const totalDiscount = adjustedPrice - parseFloat(basePrice);

  return {
    adjusted_price: adjustedPrice,
    original_price: parseFloat(basePrice),
    price_change:   totalDiscount,
    price_change_pct: Math.round((totalDiscount / parseFloat(basePrice)) * 100),
    applied_rules:  appliedRules,
  };
};

/**
 * Áp dụng price rules vào 1 flight object từ search result
 * Gắn thêm adjusted_price vào seat
 */
const applyPriceRules = async (flight, departureDate) => {
  const rules = await getApplicableRules(departureDate, {
    seatClass:     flight.seat.class,
    airlineCode:   flight.airline.code,
    departureCode: flight.departure.code,
    arrivalCode:   flight.arrival.code,
  });

  const priceResult = calcAdjustedPrice(flight.seat.base_price, rules);

  return {
    ...flight,
    seat: {
      ...flight.seat,
      // Giá gốc giữ nguyên
      base_price: flight.seat.base_price,

      // Giá sau điều chỉnh — FE dùng cái này để hiển thị và thanh toán
      adjusted_price:    priceResult.adjusted_price,
      price_change:      priceResult.price_change,
      price_change_pct:  priceResult.price_change_pct,

      // Tổng tiền toàn đoàn theo giá đã điều chỉnh
      total_price: calcTotalPriceAdjusted(
        priceResult.adjusted_price,
        flight.seat.total_price,
        flight.seat.base_price
      ),

      // Các rule đang áp dụng (FE dùng để hiển thị badge "Tết +40%")
      price_rules: priceResult.applied_rules,
      has_price_adjustment: priceResult.applied_rules.length > 0,
    },
  };
};

// Helper: scale total_price theo tỉ lệ adjusted/base
const calcTotalPriceAdjusted = (adjustedPrice, originalTotalPrice, basePrice) => {
  if (!basePrice || basePrice === 0) return originalTotalPrice;
  const ratio = adjustedPrice / parseFloat(basePrice);
  return Math.round(parseFloat(originalTotalPrice) * ratio);
};

// ─── Admin CRUD ────────────────────────────────────────────────────────────────

const VALID_TYPES = ['seasonal', 'holiday', 'weekend', 'event'];

const validateRule = (data, isUpdate = false) => {
  const { name, type, start_date, end_date, adjustment_type, adjustment_value } = data;

  if (!isUpdate) {
    if (!name)             throw new Error("name là bắt buộc");
    if (!start_date)       throw new Error("start_date là bắt buộc (YYYY-MM-DD)");
    if (!end_date)         throw new Error("end_date là bắt buộc (YYYY-MM-DD)");
    if (!adjustment_value) throw new Error("adjustment_value là bắt buộc");
  }

  if (type && !VALID_TYPES.includes(type)) {
    throw new Error(`type phải là: ${VALID_TYPES.join(', ')}`);
  }
  if (adjustment_type && !['percent', 'fixed'].includes(adjustment_type)) {
    throw new Error("adjustment_type phải là: percent | fixed");
  }
  if (start_date && end_date && new Date(end_date) < new Date(start_date)) {
    throw new Error("end_date phải >= start_date");
  }
  if (adjustment_type === 'percent' && adjustment_value) {
    const v = parseFloat(adjustment_value);
    if (v < -90 || v > 300) throw new Error("Percent phải trong khoảng -90% đến +300%");
  }
};

const getAllRules = async () => {
  const result = await pool.query(Q.GET_ALL_RULES);
  return result.rows;
};

const getRuleById = async (id) => {
  const result = await pool.query(Q.GET_RULE_BY_ID, [id]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy rule");
  return result.rows[0];
};

const createRule = async (data) => {
  validateRule(data);
  const {
    name, type = 'seasonal', start_date, end_date,
    adjustment_type = 'percent', adjustment_value,
    applies_to_class = null, applies_to_airline_code = null,
    applies_to_departure_code = null, applies_to_arrival_code = null,
    priority = 5, is_active = true,
  } = data;

  const result = await pool.query(Q.INSERT_RULE, [
    name, type, start_date, end_date,
    adjustment_type, parseFloat(adjustment_value),
    applies_to_class, applies_to_airline_code,
    applies_to_departure_code, applies_to_arrival_code,
    priority, is_active,
  ]);
  return result.rows[0];
};

const updateRule = async (id, data) => {
  validateRule(data, true);
  await getRuleById(id); // check exists

  const {
    name, type, start_date, end_date,
    adjustment_type, adjustment_value,
    applies_to_class, applies_to_airline_code,
    applies_to_departure_code, applies_to_arrival_code,
    priority, is_active,
  } = data;

  const result = await pool.query(Q.UPDATE_RULE, [
    id,
    name       || null,
    type       || null,
    start_date || null,
    end_date   || null,
    adjustment_type  || null,
    adjustment_value ? parseFloat(adjustment_value) : null,
    applies_to_class              !== undefined ? applies_to_class              : undefined,
    applies_to_airline_code       !== undefined ? applies_to_airline_code       : undefined,
    applies_to_departure_code     !== undefined ? applies_to_departure_code     : undefined,
    applies_to_arrival_code       !== undefined ? applies_to_arrival_code       : undefined,
    priority   || null,
    is_active !== undefined ? is_active : null,
  ]);
  return result.rows[0];
};

const deleteRule = async (id) => {
  const result = await pool.query(Q.DELETE_RULE, [id]);
  if (result.rows.length === 0) {
    throw new Error("Không tìm thấy rule hoặc rule này do hệ thống tạo (không thể xóa)");
  }
  return { message: "Đã xóa rule thành công" };
};

const toggleRule = async (id) => {
  const result = await pool.query(Q.TOGGLE_RULE, [id]);
  if (result.rows.length === 0) throw new Error("Không tìm thấy rule");
  const r = result.rows[0];
  return { message: r.is_active ? "Đã kích hoạt rule" : "Đã tắt rule", ...r };
};

/**
 * Preview: xem giá sẽ thay đổi thế nào nếu áp dụng rule vào ngày cụ thể
 */
const previewPrice = async (basePrice, date, options = {}) => {
  const rules = await getApplicableRules(date, options);
  return {
    date,
    base_price: parseFloat(basePrice),
    ...calcAdjustedPrice(basePrice, rules),
  };
};

module.exports = {
  // Core
  getApplicableRules,
  calcAdjustedPrice,
  applyPriceRules,
  // Admin CRUD
  getAllRules,
  getRuleById,
  createRule,
  updateRule,
  deleteRule,
  toggleRule,
  previewPrice,
};