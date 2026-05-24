const config = require('../config/payment.config');

let payosClient = null;

const getRequiredConfig = (name, value) => {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
};

const optionalConfig = (value) => {
  const normalized = String(value || '').trim();
  return normalized || null;
};

const optionalPayosBaseUrl = (value) => {
  const normalized = optionalConfig(value);
  if (!normalized) return null;

  try {
    const url = new URL(normalized);
    if (url.hostname !== 'api-merchant.payos.vn') return null;
    return url.origin;
  } catch (_) {
    return null;
  }
};

const getPayosClient = () => {
  if (!config.payos.enabled) {
    throw new Error('payOS config is incomplete. Please set PAYOS_CLIENT_ID, PAYOS_API_KEY, and PAYOS_CHECKSUM_KEY.');
  }

  if (!payosClient) {
    const PayOS = require('@payos/node');
    payosClient = new PayOS(
      getRequiredConfig('PAYOS_CLIENT_ID', config.payos.clientId),
      getRequiredConfig('PAYOS_API_KEY', config.payos.apiKey),
      getRequiredConfig('PAYOS_CHECKSUM_KEY', config.payos.checksumKey),
    );
  }

  return payosClient;
};

const resolveOrderCode = (payment) => {
  const existingOrderCode = Number(payment.gateway_response && payment.gateway_response.order_code);
  if (Number.isSafeInteger(existingOrderCode) && existingOrderCode > 0) return existingOrderCode;

  const byId = Number(payment.id);
  if (Number.isSafeInteger(byId) && byId > 0) return byId;

  const paymentCode = String(payment.payment_code || '');
  const digits = paymentCode.replace(/\D/g, '');
  if (digits.length > 0) {
    const trimmed = Number(digits.length > 13 ? digits.slice(0, 13) : digits);
    if (Number.isSafeInteger(trimmed) && trimmed > 0) return trimmed;
  }

  return Date.now();
};

const resolveDescription = (paymentCode) => {
  const normalized = String(paymentCode || '')
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .slice(0, 25);
  return normalized || 'PAYMENT';
};

const resolveUrl = ({ providedUrl, fallbackPath, paymentCode }) => {
  if (providedUrl) {
    return providedUrl;
  }

  if (!config.payos.publicBaseUrl || !fallbackPath) {
    return '';
  }

  const separator = fallbackPath.includes('?') ? '&' : '?';
  return `${config.payos.publicBaseUrl}${fallbackPath}${separator}payment_code=${encodeURIComponent(paymentCode)}`;
};

const createPayosPaymentInstruction = async (payment) => {
  const payos = getPayosClient();
  const amount = Math.round(Number(payment.final_amount ?? payment.amount ?? 0));

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('payOS amount is invalid');
  }

  const paymentCode = String(payment.payment_code || '').trim();
  if (!paymentCode) {
    throw new Error('payment.payment_code is required');
  }

  const orderCode = resolveOrderCode(payment);
  const expiresAt = payment.expires_at
    ? Math.floor(new Date(payment.expires_at).getTime() / 1000)
    : undefined;

  const returnUrl = resolveUrl({
    providedUrl: config.payos.returnUrl,
    fallbackPath: '/api/payments/return/payos/success',
    paymentCode,
  });
  const cancelUrl = resolveUrl({
    providedUrl: config.payos.cancelUrl,
    fallbackPath: '/api/payments/return/payos/cancel',
    paymentCode,
  });

  if (!returnUrl || !cancelUrl) {
    throw new Error('payOS redirect URLs are incomplete');
  }

  const response = await payos.createPaymentLink({
    orderCode,
    amount,
    description: resolveDescription(paymentCode),
    returnUrl,
    cancelUrl,
    buyerName: payment.customer_name || undefined,
    buyerEmail: payment.contact_email || undefined,
    buyerPhone: payment.contact_phone || undefined,
    expiredAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : undefined,
    items: [
      {
        name: `Booking ${paymentCode}`.slice(0, 25),
        quantity: 1,
        price: amount,
      },
    ],
  });

  return {
    provider: 'PAYOS',
    order_code: response.orderCode,
    payment_link_id: response.paymentLinkId,
    checkout_url: response.checkoutUrl,
    redirect_url: config.payos.publicBaseUrl
      ? `${config.payos.publicBaseUrl}/payments/${encodeURIComponent(paymentCode)}/payos/checkout`
      : response.checkoutUrl,
    webhook_url: config.payos.webhookUrl || null,
    return_url: returnUrl,
    cancel_url: cancelUrl,
    qr_code: response.qrCode || null,
    qr_payload: response.qrCode || null,
    description: response.description || paymentCode,
    amount: response.amount,
    currency: response.currency || 'VND',
    bank_bin: response.bin || null,
    bank_account: response.accountNumber || null,
    account_name: response.accountName || null,
    status: response.status || null,
  };
};

const verifyPayosWebhookData = async (payload = {}) => {
  const payos = getPayosClient();
  return payos.verifyPaymentWebhookData(payload);
};

const getPayosPaymentLink = async (orderCode) => {
  const payos = getPayosClient();
  return payos.getPaymentLinkInformation(Number(orderCode));
};

const cancelPayosPaymentLink = async (orderCode, cancellationReason = 'Cancelled by backend') => {
  const payos = getPayosClient();
  return payos.cancelPaymentLink(Number(orderCode), cancellationReason);
};

module.exports = {
  createPayosPaymentInstruction,
  verifyPayosWebhookData,
  getPayosPaymentLink,
  cancelPayosPaymentLink,
};
