'use strict';

const svc = require('../../services/admin/auto-flight.service');

const getStatus = async (req, res) => {
  try {
    const status = await svc.getStatus();
    res.json(status);
  } catch (err) {
    console.error('[AutoFlight] getStatus:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const getConfig = async (req, res) => {
  try {
    const config = await svc.getConfig();
    res.json(config);
  } catch (err) {
    console.error('[AutoFlight] getConfig:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const saveConfig = async (req, res) => {
  try {
    const config = await svc.saveConfig(req.body);
    res.json(config);
  } catch (err) {
    console.error('[AutoFlight] saveConfig:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const runNow = async (req, res) => {
  try {
    const result = await svc.runBatch(req.body?.batch_size || 50, true);
    res.json({ message: `Đã tạo ${result.created} chuyến, bỏ qua ${result.skipped}`, ...result });
  } catch (err) {
    console.error('[AutoFlight] runNow:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const runAll = async (req, res) => {
  try {
    const result = await svc.runBatch(0, true, true); // unlimited=true
    res.json({ message: `Đã tạo toàn bộ ${result.created} chuyến, bỏ qua ${result.skipped}`, ...result });
  } catch (err) {
    console.error('[AutoFlight] runAll:', err.message);
    res.status(500).json({ error: err.message });
  }
};

const runFromAirport = async (req, res) => {
  const { airport_code, arr_airport_code, start_date, end_date, flights_per_route, mode } = req.body;
  if (!airport_code || !start_date || !end_date || !flights_per_route) {
    return res.status(400).json({ error: 'Thiếu tham số: airport_code, start_date, end_date, flights_per_route' });
  }
  if (!['per_day', 'total'].includes(mode)) {
    return res.status(400).json({ error: 'mode phải là per_day hoặc total' });
  }
  try {
    const result = await svc.runFromAirport({
      airportCode:     airport_code.toUpperCase(),
      arrAirportCode:  arr_airport_code ? arr_airport_code.toUpperCase() : null,
      startDate:       start_date,
      endDate:         end_date,
      flightsPerRoute: parseInt(flights_per_route),
      mode,
    });
    res.json({ message: `Tạo xong: ${result.created} chuyến, bỏ qua ${result.skipped}`, ...result });
  } catch (err) {
    console.error('[AirportBatch] error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getStatus, getConfig, saveConfig, runNow, runAll, runFromAirport };
