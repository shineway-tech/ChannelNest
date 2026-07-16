const lodash = require('lodash');

const productionEnvironments = new Set(['prod', 'production']);

const requiredProductionValues = [
  'sign_token',
  'jwt_secret',
  'mysql.db.database',
  'mysql.db.userName',
  'mysql.db.conn.host',
  'email.smtp.host',
  'email.smtp.user',
  'email.smtp.password',
  'email.from.address',
  'email.code_hmac_pepper',
  'openai.api_key',
  'openai.base_url',
  'openai.safety_identifier_hmac_pepper',
  'openai.text.model',
  'openai.image.model',
  'payment.provider',
  'payment.callback_base_url',
  'payment.alipay.app_id',
  'payment.alipay.merchant_id',
  'payment.alipay.signing_private_key',
  'payment.alipay.provider_public_key_or_cert',
  'ai_temp_storage.path',
];

function isMissing(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function validateConfig(config) {
  if (!productionEnvironments.has(String(config.env || '').toLowerCase())) return;

  const missing = requiredProductionValues.filter((key) => isMissing(lodash.get(config, key)));
  if (missing.length) {
    throw new Error(`Missing production configuration: ${missing.join(', ')}`);
  }

  if (!String(config.payment.callback_base_url).startsWith('https://')) {
    throw new Error('payment.callback_base_url must use HTTPS in production');
  }
  if (config.jwt_secret === 'channel-nest-local-secret'
    || config.sign_token === 'channel-nest-local-sign') {
    throw new Error('Production authentication secrets must not use local defaults');
  }
}

module.exports = validateConfig;
