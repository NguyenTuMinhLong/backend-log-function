"use strict";

/*
============================================================
ANCILLARY SERVICE - Dịch vụ bổ sung (meal, baggage, insurance...)
============================================================

Các loại dịch vụ:
- meal: Bữa ăn
- baggage: Hành lý thêm
- insurance: Bảo hiểm
- lounge: Phòng chờ
- wifi: Wifi trên máy bay
============================================================
*/

const pool = require("../config/db");
const Q    = require("../queries/ancillary.queries");

// Helpers

const VALID_TYPES = ["meal", "baggage", "insurance", "lounge", "wifi"];

// Nhóm ancillaries theo passenger
const groupByPassenger = (rows) => {
  const map = {};
  for (const r of rows) {
    const key = `${r.passenger_id}_${r.flight_type}`;
    if (!map[key]) {
      map[key] = {
        passenger_id:   r.passenger_id,
        passenger_name: r.passenger_name,
        passenger_type: r.passenger_type,
        flight_type:    r.flight_type,
        services:       [],
      };
    }
    map[key].services.push({
      ancillary_id:        r.id,
      option_id:           r.option_id,
      service_type:        r.service_type,
      service_name:        r.service_name,
      service_description: r.service_description,
      unit:                r.unit,
      meta:                r.meta,
      quantity:            r.quantity,
      unit_price:          parseFloat(r.unit_price),
      total_price:         parseFloat(r.total_price),
      status:              r.status,
    });
  }
  return Object.values(map);
};

// ─── Exported Functions ───────────────────────────────────────────────────────

// Lấy danh sách dịch vụ có thể chọn
const getAncillaryOptions = async (type = null) => {
  if (type && !VALID_TYPES.includes(type)) {
    throw new Error(`type phải là một trong: ${VALID_TYPES.join(", ")}`);
  }

  const result = await pool.query(Q.GET_ANCILLARY_OPTIONS, [type || null]);

  // Group theo type để FE dễ render từng section
  const grouped = {};
  for (const row of result.rows) {
    if (!grouped[row.type]) grouped[row.type] = [];
    grouped[row.type].push({
      id:          row.id,
      name:        row.name,
      description: row.description,
      price:       parseFloat(row.price),
      unit:        row.unit,
      meta:        row.meta,
    });
  }

  return {
    types:   VALID_TYPES.filter(t => grouped[t]),
    options: grouped,
  };
};

// Lấy ancillaries đã chọn của 1 booking
const getBookingAncillaries = async (bookingId) => {
  const rows        = await pool.query(Q.GET_ANCILLARIES_BY_BOOKING, [bookingId]);
  const totalResult = await pool.query(Q.GET_ANCILLARY_TOTAL, [bookingId]);

  return {
    booking_id:      parseInt(bookingId),
    ancillary_total: parseFloat(totalResult.rows[0].ancillary_total),
    by_passenger:    groupByPassenger(rows.rows),
  };
};

// Thêm dịch vụ cho 1 hành khách
const addAncillary = async (bookingId, data) => {
  const {
    passenger_id,
    ancillary_option_id,
    flight_type = "outbound",
    quantity    = 1,
  } = data;

  if (!passenger_id)        throw new Error("passenger_id là bắt buộc");
  if (!ancillary_option_id) throw new Error("ancillary_option_id là bắt buộc");
  if (!["outbound", "return"].includes(flight_type)) {
    throw new Error("flight_type phải là outbound hoặc return");
  }
  if (parseInt(quantity) < 1) throw new Error("quantity phải >= 1");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Kiểm tra passenger thuộc booking này không
    const passengerCheck = await client.query(
      Q.CHECK_PASSENGER_IN_BOOKING, [passenger_id, bookingId]
    );
    if (passengerCheck.rows.length === 0) {
      throw new Error("Hành khách không thuộc booking này");
    }

    // 2. Kiểm tra option tồn tại và đang active
    const optionResult = await client.query(
      Q.GET_ANCILLARY_OPTION_BY_ID, [ancillary_option_id]
    );
    if (optionResult.rows.length === 0) {
      throw new Error("Dịch vụ bổ sung không tồn tại");
    }
    const option = optionResult.rows[0];
    if (!option.is_active) {
      throw new Error("Dịch vụ bổ sung này hiện không khả dụng");
    }

    // 3. Kiểm tra duplicate (trừ baggage vì có thể chọn nhiều loại kg)
    if (option.type !== "baggage") {
      const dupCheck = await client.query(
        Q.CHECK_DUPLICATE_ANCILLARY,
        [bookingId, passenger_id, ancillary_option_id, flight_type]
      );
      if (dupCheck.rows.length > 0) {
        throw new Error("Hành khách đã chọn dịch vụ này rồi");
      }
    }

    // 4. Tính giá
    const unitPrice  = parseFloat(option.price);
    const qty        = parseInt(quantity);
    const totalPrice = unitPrice * qty;

    // 5. Insert
    const result = await client.query(Q.INSERT_ANCILLARY, [
      bookingId, passenger_id, ancillary_option_id,
      flight_type, qty, unitPrice, totalPrice,
    ]);

    // 6. Tính tổng mới
    const totalResult = await client.query(Q.GET_ANCILLARY_TOTAL, [bookingId]);

    await client.query("COMMIT");

    return {
      message:         "Đã thêm dịch vụ bổ sung thành công",
      ancillary:       result.rows[0],
      service_name:    option.name,
      service_type:    option.type,
      unit_price:      unitPrice,
      total_price:     totalPrice,
      ancillary_total: parseFloat(totalResult.rows[0].ancillary_total),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Huỷ 1 dịch vụ bổ sung
 * SB-04 Step 3: User bỏ chọn dịch vụ
 */
const removeAncillary = async (bookingId, ancillaryId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const result = await client.query(Q.CANCEL_ANCILLARY, [ancillaryId, bookingId]);
    if (result.rows.length === 0) {
      throw new Error("Không tìm thấy dịch vụ bổ sung hoặc không thuộc booking này");
    }

    // Tổng mới sau khi huỷ
    const totalResult = await client.query(Q.GET_ANCILLARY_TOTAL, [bookingId]);

    await client.query("COMMIT");

    return {
      message:         "Đã huỷ dịch vụ bổ sung",
      ancillary_total: parseFloat(totalResult.rows[0].ancillary_total),
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * Lấy tổng tiền booking bao gồm ancillaries
 * SB-04 Step 4: Tính lại tổng tiền
 */
const getBookingTotal = async (bookingId) => {
  const [bookingResult, ancillaryResult] = await Promise.all([
    pool.query(`SELECT total_price FROM bookings WHERE id = $1`, [bookingId]),
    pool.query(Q.GET_ANCILLARY_TOTAL, [bookingId]),
  ]);

  if (bookingResult.rows.length === 0) throw new Error("Không tìm thấy booking");

  const ticketPrice    = parseFloat(bookingResult.rows[0].total_price);
  const ancillaryTotal = parseFloat(ancillaryResult.rows[0].ancillary_total);

  return {
    booking_id:      parseInt(bookingId),
    ticket_price:    ticketPrice,
    ancillary_total: ancillaryTotal,
    grand_total:     ticketPrice + ancillaryTotal,
  };
};

module.exports = {
  getAncillaryOptions,
  getBookingAncillaries,
  addAncillary,
  removeAncillary,
  getBookingTotal,
};