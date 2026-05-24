/**
 * Payment Gateway Configuration
 * Cấu hình cho các cổng thanh toán: PayOS, MoMo, PayPal, BANK_QR
 */

const parseIntSafe = (value, fallback = null) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const parseFloatSafe = (value, fallback = null) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const trimSlash = (value = '') => String(value || '').replace(/\/+$/, '');

const publicBaseUrl = trimSlash(process.env.PAYMENT_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || '');
const frontendUrl = trimSlash(process.env.FRONTEND_URL || '');

const paymentConfig = {
  bankQr: {
    enabled: process.env.BANK_QR_ENABLED !== 'false',
    bankCode: process.env.BANK_QR_BANK_CODE || 'ICB',
    bankName: process.env.BANK_QR_BANK_NAME || 'VietinBank',
    bin: process.env.BANK_QR_BANK_BIN || process.env.BANK_QR_BANK_CODE || '970415',
    accountNumber: process.env.BANK_QR_ACCOUNT_NUMBER || '',
    accountName: process.env.BANK_QR_ACCOUNT_NAME || '',
    template: process.env.BANK_QR_TEMPLATE || 'compact2',
  },

  payos: {
    enabled:
      process.env.PAYOS_ENABLED !== 'false' &&
      Boolean(
        process.env.PAYOS_CLIENT_ID &&
        process.env.PAYOS_API_KEY &&
        process.env.PAYOS_CHECKSUM_KEY
      ),
    clientId: process.env.PAYOS_CLIENT_ID || '',
    apiKey: process.env.PAYOS_API_KEY || '',
    checksumKey: process.env.PAYOS_CHECKSUM_KEY || '',
    partnerCode: process.env.PAYOS_PARTNER_CODE || '',
    baseUrl: process.env.PAYOS_BASE_URL || '',
    publicBaseUrl,
    frontendUrl,
    returnUrl: process.env.PAYOS_RETURN_URL || '',
    cancelUrl: process.env.PAYOS_CANCEL_URL || '',
    webhookUrl: process.env.PAYOS_WEBHOOK_URL || '',
    webhookPath: process.env.PAYOS_WEBHOOK_PATH || '/payments/payos/webhook',
  },

  momo: {
    enabled:
      process.env.MOMO_ENABLED !== 'false' &&
      Boolean(
        process.env.MOMO_PARTNER_CODE &&
        process.env.MOMO_ACCESS_KEY &&
        process.env.MOMO_SECRET_KEY &&
        process.env.MOMO_ENDPOINT
      ),
    partnerCode: process.env.MOMO_PARTNER_CODE || '',
    accessKey: process.env.MOMO_ACCESS_KEY || '',
    secretKey: process.env.MOMO_SECRET_KEY || '',
    endpoint: process.env.MOMO_ENDPOINT || 'https://test-payment.momo.vn/v2/gateway/api/create',
    requestType: process.env.MOMO_REQUEST_TYPE || 'payWithMethod',
    publicBaseUrl,
    frontendUrl,
    redirectPath: process.env.MOMO_REDIRECT_PATH || '/payments/momo/return',
    ipnPath: process.env.MOMO_IPN_PATH || '/payments/momo/ipn',
    redirectUrl: process.env.MOMO_REDIRECT_URL || '',
    ipnUrl: process.env.MOMO_IPN_URL || '',
    convertRate: parseFloatSafe(process.env.MOMO_CONVERT_RATE, 1),
    lang: process.env.MOMO_LANG || 'vi',
  },

  paypal: {
    enabled:
      process.env.PAYPAL_ENABLED !== 'false' &&
      Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET),
    env: process.env.PAYPAL_ENV === 'production' ? 'production' : 'sandbox',
    clientId: process.env.PAYPAL_CLIENT_ID || '',
    clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
    publicBaseUrl,
    frontendUrl,
    returnPath: process.env.PAYPAL_RETURN_PATH || '/api/payments/return/paypal',
    cancelPath: process.env.PAYPAL_CANCEL_PATH || '/api/payments/cancel/paypal',
    returnUrl: process.env.PAYPAL_RETURN_URL || '',
    cancelUrl: process.env.PAYPAL_CANCEL_URL || '',
    currency: process.env.PAYPAL_CURRENCY || 'VND',
    convertRate: parseFloatSafe(process.env.PAYPAL_CONVERT_RATE, 1),
    brandName: process.env.PAYPAL_BRAND_NAME || 'FlightBooking',
  },

  payment: {
    expiresInMinutes: parseIntSafe(process.env.PAYMENT_EXPIRES_IN_MINUTES, 15),
  },
};

// Auto-build webhook/callback URLs from publicBaseUrl if not set
if (!paymentConfig.payos.webhookUrl && paymentConfig.payos.publicBaseUrl) {
  paymentConfig.payos.webhookUrl = `${paymentConfig.payos.publicBaseUrl}${paymentConfig.payos.webhookPath}`;
}

if (!paymentConfig.momo.redirectUrl && paymentConfig.momo.publicBaseUrl) {
  paymentConfig.momo.redirectUrl = `${paymentConfig.momo.publicBaseUrl}${paymentConfig.momo.redirectPath}`;
}
if (!paymentConfig.momo.ipnUrl && paymentConfig.momo.publicBaseUrl) {
  paymentConfig.momo.ipnUrl = `${paymentConfig.momo.publicBaseUrl}${paymentConfig.momo.ipnPath}`;
}

if (!paymentConfig.paypal.returnUrl && paymentConfig.paypal.publicBaseUrl) {
  paymentConfig.paypal.returnUrl = `${paymentConfig.paypal.publicBaseUrl}${paymentConfig.paypal.returnPath}`;
}
if (!paymentConfig.paypal.cancelUrl && paymentConfig.paypal.publicBaseUrl) {
  paymentConfig.paypal.cancelUrl = `${paymentConfig.paypal.publicBaseUrl}${paymentConfig.paypal.cancelPath}`;
}

module.exports = paymentConfig;
