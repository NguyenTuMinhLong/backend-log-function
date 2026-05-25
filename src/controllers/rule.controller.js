"use strict";

const priceRuleService = require("../services/price-rule.service");

/** GET /api/admin/price-rules */
const getAllRules = async (req, res) => {
  try {
    const data = await priceRuleService.getAllRules();
    res.json({ message: "Lấy danh sách price rules thành công", data });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

/** GET /api/admin/price-rules/:id */
const getRuleById = async (req, res) => {
  try {
    const data = await priceRuleService.getRuleById(req.params.id);
    res.json({ data });
  } catch (err) { res.status(404).json({ error: err.message }); }
};

/** POST /api/admin/price-rules */
const createRule = async (req, res) => {
  try {
    const data = await priceRuleService.createRule(req.body);
    res.status(201).json({ message: "Tạo price rule thành công", data });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

/** PUT /api/admin/price-rules/:id */
const updateRule = async (req, res) => {
  try {
    const data = await priceRuleService.updateRule(req.params.id, req.body);
    res.json({ message: "Cập nhật price rule thành công", data });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

/** DELETE /api/admin/price-rules/:id */
const deleteRule = async (req, res) => {
  try {
    const data = await priceRuleService.deleteRule(req.params.id);
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
};

/** PATCH /api/admin/price-rules/:id/toggle */
const toggleRule = async (req, res) => {
  try {
    const data = await priceRuleService.toggleRule(req.params.id);
    res.json(data);
  } catch (err) { res.status(400).json({ error: err.message }); }
};

/**
 * GET /api/admin/price-rules/preview
 * Xem giá sẽ thay đổi thế nào khi áp dụng rule
 * Query: ?base_price=1000000&date=2026-01-30&seat_class=economy
 */
const previewPrice = async (req, res) => {
  try {
    const { base_price, date, seat_class, airline_code, departure_code, arrival_code } = req.query;
    if (!base_price || !date) {
      return res.status(400).json({ error: "base_price và date là bắt buộc" });
    }
    const data = await priceRuleService.previewPrice(base_price, date, {
      seatClass:     seat_class,
      airlineCode:   airline_code,
      departureCode: departure_code,
      arrivalCode:   arrival_code,
    });
    res.json({ data });
  } catch (err) { res.status(400).json({ error: err.message }); }
};

module.exports = { getAllRules, getRuleById, createRule, updateRule, deleteRule, toggleRule, previewPrice };