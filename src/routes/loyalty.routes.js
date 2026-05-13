const express = require('express');
const router = express.Router();
const { getMyMembership } = require('../controllers/loyalty.controller');

// Tạm thời bỏ middleware protect để test
// Sau này bạn sẽ thêm lại khi biết đúng path middleware của project
router.get('/me', getMyMembership);     // ← tạm bỏ protect

module.exports = router;