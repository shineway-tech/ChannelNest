const { AlipaySdk } = require('alipay-sdk');
const config = require('../../config');

let sdk;

function paymentError(message, kind, providerCode = '') {
  const error = new Error(message);
  error.alipayErrorKind = kind;
  error.providerCode = providerCode;
  return error;
}

function isConfigured() {
  const settings = config.payment.alipay;
  return Boolean(
    config.payment.provider === 'alipay'
      && config.payment.callback_base_url
      && settings.app_id
      && settings.signing_private_key
      && settings.provider_public_key_or_cert,
  );
}

function client() {
  if (!sdk) {
    const settings = config.payment.alipay;
    if (!isConfigured()) {
      throw paymentError('Alipay service is not configured', 'configuration');
    }
    sdk = new AlipaySdk({
      appId: settings.app_id,
      privateKey: settings.signing_private_key,
      alipayPublicKey: settings.provider_public_key_or_cert,
      keyType: 'PKCS8',
      gateway: settings.gateway,
      signType: settings.sign_type,
      charset: settings.charset,
    });
  }

  return sdk;
}

function notifyUrl() {
  return `${String(config.payment.callback_base_url).replace(/\/$/, '')}/v1/billing/payment-callbacks/alipay`;
}

function createWebsitePayment(input) {
  const checkoutUrl = client().pageExecute('alipay.trade.page.pay', 'GET', {
    notifyUrl: notifyUrl(),
    bizContent: {
      out_trade_no: input.providerOrderId,
      product_code: 'FAST_INSTANT_TRADE_PAY',
      total_amount: (input.amountFen / 100).toFixed(2),
      subject: input.subject,
      timeout_express: `${Math.max(1, Math.floor(input.expiresInSeconds / 60))}m`,
      qr_pay_mode: '4',
      qrcode_width: 220,
    },
  });

  let parsedCheckoutUrl;
  try {
    parsedCheckoutUrl = new URL(checkoutUrl);
  } catch {
    throw paymentError('Alipay did not return a valid checkout URL', 'provider');
  }
  const gatewayUrl = new URL(config.payment.alipay.gateway);
  if (parsedCheckoutUrl.protocol !== 'https:' || parsedCheckoutUrl.origin !== gatewayUrl.origin) {
    throw paymentError('Alipay returned an unexpected checkout URL', 'provider');
  }

  return {
    providerOrderId: input.providerOrderId,
    checkoutType: 'checkout_url',
    checkoutValue: checkoutUrl,
  };
}

function classifyError(error) {
  if (error.alipayErrorKind === 'configuration') return 'configuration';
  const signature = [error.providerCode, error.code, error.message].filter(Boolean).join(' ').toLowerCase();
  if (/access.?forbidden|merchant.?agreement|no right to access/.test(signature)) {
    return 'permission';
  }
  if (/invalid.?signature|app.?id|private.?key|public.?key|rsa|pem|decoder|keytype/.test(signature)) {
    return 'configuration';
  }
  if (/timeout|timed.?out|econn|socket|network|httpclient request error/.test(signature)) {
    return 'network';
  }
  return error.alipayErrorKind || 'provider';
}

async function queryTrade(providerOrderId) {
  const response = await client().exec('alipay.trade.query', {
    bizContent: { out_trade_no: providerOrderId },
  });
  if (response.code !== '10000') {
    if (response.subCode === 'ACQ.TRADE_NOT_EXIST') return { tradeStatus: 'pending' };
    throw paymentError(
      response.subMsg || response.msg || 'Alipay trade query failed',
      'provider',
      response.subCode || response.code || '',
    );
  }

  let tradeStatus = 'pending';
  if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(response.tradeStatus)) {
    tradeStatus = 'succeeded';
  } else if (response.tradeStatus === 'TRADE_CLOSED') {
    tradeStatus = 'closed';
  }

  return {
    tradeStatus,
    providerOrderId: response.outTradeNo || providerOrderId,
    providerTradeId: response.tradeNo || null,
    amountFen: response.totalAmount == null
      ? null : Math.round(Number(response.totalAmount) * 100),
  };
}

async function closeTrade(providerOrderId) {
  return client().exec('alipay.trade.close', {
    bizContent: { out_trade_no: providerOrderId },
  });
}

function verifyNotification(body) {
  if (!client().checkNotifySignV2(body)) return { valid: false, reason: 'invalid_signature' };
  if (String(body.app_id) !== String(config.payment.alipay.app_id)) {
    return { valid: false, reason: 'app_id_mismatch' };
  }
  if (config.payment.alipay.merchant_id
    && String(body.seller_id) !== String(config.payment.alipay.merchant_id)) {
    return { valid: false, reason: 'merchant_id_mismatch' };
  }

  let tradeStatus = 'pending';
  if (['TRADE_SUCCESS', 'TRADE_FINISHED'].includes(body.trade_status)) {
    tradeStatus = 'succeeded';
  } else if (body.trade_status === 'TRADE_CLOSED') {
    tradeStatus = 'closed';
  }

  return {
    valid: true,
    providerOrderId: body.out_trade_no,
    providerTradeId: body.trade_no,
    tradeStatus,
    amountFen: Math.round(Number(body.total_amount) * 100),
    currency: 'CNY',
    eventId: body.notify_id || null,
    eventType: body.trade_status || 'UNKNOWN',
  };
}

module.exports = {
  classifyError,
  closeTrade,
  createWebsitePayment,
  isConfigured,
  queryTrade,
  verifyNotification,
};
