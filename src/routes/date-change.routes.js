'use strict';

/*
=========================================================
DATE CHANGE ROUTES - User Endpoints
=========================================================
*/

const express = require('express');
const router = express.Router();
const dateChangeController = require('../controllers/date-change.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// User routes - phải đăng nhập
router.get('/my', authenticate, dateChangeController.getMyDateChanges);

// User routes - xem chi tiết
router.get('/:requestCode', dateChangeController.getDateChangeDetail);

// User hủy date change request
router.delete('/:requestCode', authenticate, dateChangeController.cancelDateChangeRequest);

module.exports = router;
