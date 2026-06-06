'use strict';

const svc  = require('../../services/admin/auto-flight.service');

// Lưu trạng thái job ngầm trong memory (reset khi server restart)
const bgJob = { running: false, created: 0, skipped: 0, round: 0, startedAt: null, error: null };

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
  if (!['per_day', 'total', 'all_airlines'].includes(mode)) {
    return res.status(400).json({ error: 'mode phải là per_day, total hoặc all_airlines' });
  }
  try {
    const result = await svc.runFromAirport({
      airportCode:     airport_code.toUpperCase(),
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

// Trả ngay 202, chạy loop ngầm trên server — đóng browser vẫn tiếp tục
const runFromAirportBg = (req, res) => {
  const { airport_code, start_date, end_date, flights_per_route, mode } = req.body;
  if (!airport_code || !start_date || !end_date || !flights_per_route) {
    return res.status(400).json({ error: 'Thiếu tham số' });
  }
  if (!['per_day', 'total', 'all_airlines'].includes(mode)) {
    return res.status(400).json({ error: 'mode không hợp lệ' });
  }
  if (bgJob.running) {
    return res.json({ message: 'Job đang chạy', ...bgJob });
  }

  // Reset và trả về ngay
  Object.assign(bgJob, { running: true, created: 0, skipped: 0, round: 0, startedAt: new Date().toISOString(), error: null });
  res.json({ message: 'Job đã bắt đầu — có thể đóng tab', ...bgJob });

  // Chạy ngầm không await
  (async () => {
    try {
      while (true) {
        bgJob.round++;
        const result = await svc.runFromAirport({
          airportCode:     airport_code.toUpperCase(),
          startDate:       start_date,
          endDate:         end_date,
          flightsPerRoute: parseInt(flights_per_route),
          mode,
        });
        bgJob.created += result.created || 0;
        bgJob.skipped += result.skipped || 0;
        if (!result.limit_reached || (result.created || 0) === 0) break;
      }
    } catch (e) {
      bgJob.error = e.message;
      console.error('[BgJob] error:', e.message);
    } finally {
      bgJob.running = false;
    }
  })();
};

const getBgJobStatus = (req, res) => res.json(bgJob);

// Lưu job vào DB → cron 5 phút tự xử lý kể cả khi server restart
const setAirportJob = async (req, res) => {
  const { airport_code, start_date, end_date, flights_per_route, mode } = req.body;
  if (!airport_code || !start_date || !end_date || !flights_per_route) {
    return res.status(400).json({ error: 'Thiếu tham số' });
  }
  try {
    await svc.setAirportJob({ airportCode: airport_code, startDate: start_date, endDate: end_date, flightsPerRoute: parseInt(flights_per_route), mode });
    res.json({ message: 'Job đã lưu — cron 5 phút sẽ tự xử lý, đóng tab được', airport_code, start_date, end_date });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getAirportJobStatus = async (req, res) => {
  try {
    const job = await svc.getAirportJob();
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getStatus, getConfig, saveConfig, runNow, runAll, runFromAirport, runFromAirportBg, getBgJobStatus, setAirportJob, getAirportJobStatus };
