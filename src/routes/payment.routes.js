const express = require("express");
const router = express.Router();
const paymentService = require("../services/payment.service");
const dateChangeService = require("../services/date-change.service");
const { authenticate, authenticateOptional } = require("../middlewares/auth.middleware");

// Helper to check if payment is a date change payment
const isDateChangePayment = (paymentCode) => {
  return String(paymentCode || '').startsWith('PAY-DC-');
};

// Customer payment routes
router.post("/preview", authenticateOptional, async (req, res) => {
  try {
    const result = await paymentService.previewPayment(req.body, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/", authenticateOptional, async (req, res) => {
  try {
    const result = await paymentService.createPayment(req.body, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Init payment with gateway (BANK_QR/PayOS, MoMo, PayPal)
router.post("/init", authenticateOptional, async (req, res) => {
  try {
    let booking_code = req.body.booking_code;

    // Hỗ trợ frontend gửi booking_id thay vì booking_code
    if (!booking_code && req.body.booking_id) {
      const pool = require('../config/db');
      const r = await pool.query('SELECT booking_code FROM bookings WHERE id = $1', [req.body.booking_id]);
      booking_code = r.rows[0]?.booking_code;
    }

    const result = await paymentService.initPayment({
      booking_code,
      payment_method: req.body.payment_method,
      voucher_code:   req.body.voucher_code,
      userId:         req.user?.id,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/:paymentCode/confirm", authenticateOptional, async (req, res) => {
  try {
    const result = await paymentService.confirmPayment(req.params.paymentCode, req.user?.id);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.post("/:paymentCode/cancel", authenticateOptional, async (req, res) => {
  try {
    const result = await paymentService.cancelPayment({ payment_code: req.params.paymentCode });
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// GET /api/payments/my — lịch sử thanh toán của user
router.get("/my", authenticate, async (req, res) => {
  try {
    const pool = require("../config/db");
    const result = await pool.query(
      `SELECT p.*, b.booking_code 
       FROM payments p 
       JOIN bookings b ON b.id = p.booking_id 
       WHERE b.user_id = $1 
       ORDER BY p.created_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/:paymentCode", async (req, res) => {
  try {
    const result = await paymentService.getPaymentByCode(req.params.paymentCode);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(404).json({ success: false, message: error.message });
  }
});

// ── Webhook Routes ─────────────────────────────────────────────────────────────

// PayOS Webhook
router.post("/webhook/payos", async (req, res) => {
  try {
    // Check if this is a date change payment
    const description = String(req.body.description || '').trim();
    const paymentCode = description.startsWith('PAY-DC-') ? description : null;
    
    if (paymentCode) {
      // Handle date change payment
      const result = await dateChangeService.confirmDateChangePayment(paymentCode);
      return res.json({ success: true, data: result });
    }
    
    // Handle regular booking payment
    const result = await paymentService.handlePayosWebhook(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// Bank Webhook (cho VietQR reconciliation)
router.post("/webhook/bank", async (req, res) => {
  try {
    // Check if this is a date change payment
    const paymentCode = String(req.body.payment_code || '').trim();
    
    if (isDateChangePayment(paymentCode)) {
      // Handle date change payment
      const result = await dateChangeService.confirmDateChangePayment(paymentCode);
      return res.json({ success: true, data: result });
    }
    
    // Handle regular booking payment
    const result = await paymentService.handleBankWebhook(req.body);
    res.json({ success: true, data: result });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

// MoMo IPN (server-to-server)
router.post("/webhook/momo", async (req, res) => {
  try {
    // Check if this is a date change payment
    const paymentCode = String(req.body.orderId || req.body.order_id || '').trim();
    
    if (isDateChangePayment(paymentCode)) {
      // Handle date change payment
      const result = await dateChangeService.confirmDateChangePayment(paymentCode);
      return res.json({ resultCode: 0, message: 'Success', data: result });
    }
    
    // Handle regular booking payment
    const result = await paymentService.handleMomoIpn(req.body);
    res.json({ resultCode: result.resultCode, message: result.message });
  } catch (error) {
    res.status(400).json({ resultCode: 99, message: error.message });
  }
});

// MoMo Return (redirect user)
router.get("/return/momo", async (req, res) => {
  const config = require('../config/payment.config');
  const frontendBase = config.momo.frontendUrl || '';
  const resultPage = `${frontendBase}/payment/momo/result`;

  try {
    // Check if this is a date change payment
    const paymentCode = String(req.query.orderId || req.query.order_id || '').trim();
    
    if (isDateChangePayment(paymentCode)) {
      // Handle date change payment return
      const result = await dateChangeService.confirmDateChangePayment(paymentCode);
      const params = new URLSearchParams({
        status: result.status === 'pending' ? 'success' : result.status,
        paymentStatus: result.payment_status || 'SUCCESS',
        paymentCode: paymentCode,
        requestCode: result.request_code || '',
      });
      return res.redirect(`${frontendBase}/date-change/result?${params.toString()}`);
    }
    
    // Handle regular booking payment
    const result = await paymentService.handleMomoReturn(req.query);
    const status = result.return_status || (result.ok && result.resultCode === 0 ? 'success' : 'error');
    const params = new URLSearchParams({
      status,
      paymentCode: result.payment_code || '',
      bookingCode: result.booking_code || '',
    });
    return res.redirect(`${resultPage}?${params.toString()}`);
  } catch (error) {
    const params = new URLSearchParams({ status: 'error', message: error.message || '' });
    return res.redirect(`${resultPage}?${params.toString()}`);
  }
});

// PayOS Return
router.get("/return/payos/:status", async (req, res) => {
  const config = require('../config/payment.config');
  const frontendBase = config.payos.frontendUrl || '';
  const resultPage = `${frontendBase}/payment/payos/result`;

  try {
    // Check if this is a date change payment
    const paymentCode = String(req.query.payment_code || '').trim();
    
    if (isDateChangePayment(paymentCode)) {
      // Handle date change payment return
      const result = await dateChangeService.confirmDateChangePayment(paymentCode);
      const params = new URLSearchParams({
        status: result.status === 'pending' ? 'success' : result.status,
        paymentStatus: result.payment_status || 'SUCCESS',
        paymentCode: paymentCode,
        requestCode: result.request_code || '',
      });
      return res.redirect(`${frontendBase}/date-change/result?${params.toString()}`);
    }
    
    // Handle regular booking payment
    const result = await paymentService.handlePayosReturn(req.params.status, req.query);
    const params = new URLSearchParams({
      status: result.status || 'pending',
      paymentCode: result.payment_code || '',
      bookingCode: result.booking_code || '',
    });
    return res.redirect(`${resultPage}?${params.toString()}`);
  } catch (error) {
    const params = new URLSearchParams({ status: 'error', message: error.message || '' });
    return res.redirect(`${resultPage}?${params.toString()}`);
  }
});

// PayPal Return & Cancel
router.get("/return/paypal", async (req, res) => {
  const config = require('../config/payment.config');
  const frontendBase = config.paypal.frontendUrl || '';
  const resultPage = `${frontendBase}/payment/paypal/result`;

  try {
    // Check if this is a date change payment
    const paymentCode = String(req.query.payment_code || '').trim();
    
    if (isDateChangePayment(paymentCode)) {
      const orderId = String(req.query.token || req.query.orderId || '').trim();
      const payment = await paymentService.getPaymentByCode(paymentCode);
      const gatewayResponse = payment?.gateway_response || {};
      const effectiveOrderId = orderId || gatewayResponse.order_id || gatewayResponse.provider_order_code || '';

      if (!effectiveOrderId) {
        throw new Error('Missing PayPal order token for date change payment');
      }

      const capture = await paymentService.handlePaypalReturn({
        ...req.query,
        payment_code: paymentCode,
        token: effectiveOrderId,
      });

      const result = await dateChangeService.confirmDateChangePayment(paymentCode, {
        trustedPaid: true,
        gatewayPayload: {
          ...gatewayResponse,
          provider: 'PAYPAL',
          order_id: effectiveOrderId,
          provider_order_code: effectiveOrderId,
          capture_id: capture.capture_id || gatewayResponse.capture_id || null,
          capture_status: 'COMPLETED',
          approve_url: null,
          redirect_url: null,
          returnedAt: new Date().toISOString(),
        },
      });
      const params = new URLSearchParams({
        status: result.status === 'pending' ? 'success' : result.status,
        paymentStatus: result.payment_status || 'SUCCESS',
        paymentCode: paymentCode,
        requestCode: result.request_code || '',
      });
      return res.redirect(`${frontendBase}/date-change/result?${params.toString()}`);
    }
    
    // Handle regular booking payment
    const result = await paymentService.handlePaypalReturn(req.query);
    const params = new URLSearchParams({
      status: result.status || 'success',
      paymentCode: result.payment_code || '',
      bookingCode: result.booking_code || '',
      orderId: result.order_id || '',
    });
    return res.redirect(`${resultPage}?${params.toString()}`);
  } catch (error) {
    const params = new URLSearchParams({
      status: 'error',
      message: error.message || 'PayPal return failed',
    });
    return res.redirect(`${resultPage}?${params.toString()}`);
  }
});

router.get("/cancel/paypal", async (req, res) => {
  const config = require('../config/payment.config');
  const frontendBase = config.paypal.frontendUrl || '';
  const resultPage = `${frontendBase}/payment/paypal/result`;

  try {
    // Check if this is a date change payment
    const paymentCode = String(req.query.payment_code || '').trim();
    
    if (isDateChangePayment(paymentCode)) {
      // For date change payment, redirect back to date change page
      return res.redirect(`${frontendBase}/date-change?cancelled=true`);
    }
    
    // Handle regular booking payment
    const result = await paymentService.handlePaypalCancel(req.query);
    const params = new URLSearchParams({
      status: 'cancel',
      paymentCode: result.payment_code || '',
      orderId: result.order_id || '',
    });
    return res.redirect(`${resultPage}?${params.toString()}`);
  } catch (error) {
    const params = new URLSearchParams({
      status: 'cancel',
      message: error.message || '',
    });
    return res.redirect(`${resultPage}?${params.toString()}`);
  }
});

// Checkout URL getters
router.get("/:paymentCode/payos/checkout", async (req, res) => {
  try {
    const checkoutUrl = await paymentService.getPayosCheckoutUrl(req.params.paymentCode);
    res.json({ success: true, checkout_url: checkoutUrl });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

router.get("/:paymentCode/paypal/checkout", async (req, res) => {
  try {
    const checkoutUrl = await paymentService.getPaypalCheckoutUrl(req.params.paymentCode);
    res.json({ success: true, checkout_url: checkoutUrl });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
});

module.exports = router;
