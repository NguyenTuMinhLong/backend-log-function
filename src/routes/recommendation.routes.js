"use strict";

const express = require("express");
const router = express.Router();
const { authenticateOptional } = require("../middlewares/auth.middleware");
const recommendationController = require("../controllers/recommendation.controller");

// GET /api/recommendations
router.get("/", authenticateOptional, recommendationController.getRecommendations);

module.exports = router;
