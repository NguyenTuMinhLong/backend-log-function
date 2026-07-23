"use strict";

const express = require("express");
const router  = express.Router();

const ancillaryController = require("../controllers/ancillary.controller");
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// ─── Public ───────────────────────────────────────────────────────────────────

// GET /api/ancillaries
// Danh sách dịch vụ bổ sung (ai cũng xem được)
// Query: ?type=meal|baggage|insurance|lounge|wifi
router.get("/", ancillaryController.getAncillaryOptions);

module.exports = router;