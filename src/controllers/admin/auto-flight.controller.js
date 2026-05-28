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
    const result = await svc.runBatch(req.body?.batch_size || 50);
    res.json({ message: `Đã tạo ${result.created} chuyến, bỏ qua ${result.skipped}`, ...result });
  } catch (err) {
    console.error('[AutoFlight] runNow:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports = { getStatus, getConfig, saveConfig, runNow };
