'use strict';

/*
=========================================================
DATE CHANGE ROUTES - User + Admin Endpoints
=========================================================
*/

const express = require('express');
const router = express.Router();
const dateChangeController = require('../controllers/date-change.controller');
const { authenticate } = require('../middlewares/auth.middleware');

// =========================================================
// USER ROUTES
// =========================================================

/**
 * POST /api/date-changes/bookings/:bookingCode/change-flight
 * User yêu cầu đổi ngày bay
 */
router.post('/bookings/:bookingCode/change-flight', authenticate, dateChangeController.requestDateChange);

/**
 * GET /api/date-changes/bookings/:bookingCode/date-changes
 * Xem tất cả yêu cầu đổi ngày của 1 booking
 */
router.get('/bookings/:bookingCode/date-changes', dateChangeController.getBookingDateChanges);

/**
 * GET /api/date-changes/my
 * User xem lịch sử yêu cầu đổi ngày bay của mình
 */
router.get('/my', authenticate, dateChangeController.getMyDateChanges);

/**
 * GET /api/date-changes/:requestCode
 * Xem chi tiết một yêu cầu đổi ngày bay
 */
router.get('/:requestCode', dateChangeController.getDateChangeDetail);

/**
 * DELETE /api/date-changes/:requestCode
 * User hủy yêu cầu đổi ngày bay
 */
router.delete('/:requestCode', authenticate, dateChangeController.cancelDateChangeRequest);

// =========================================================
// ADMIN ROUTES
// =========================================================

/**
 * POST /api/date-changes/:requestCode/approve
 * Admin duyệt yêu cầu đổi ngày bay
 */
router.post('/:requestCode/approve', authenticate, dateChangeController.approveDateChange);

/**
 * POST /api/date-changes/:requestCode/reject
 * Admin từ chối yêu cầu đổi ngày bay
 */
router.post('/:requestCode/reject', authenticate, dateChangeController.rejectDateChange);

module.exports = router;