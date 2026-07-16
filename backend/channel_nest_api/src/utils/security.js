const crypto = require('crypto');
const config = require('../../config');

function sha256(value) {
  const input = Buffer.isBuffer(value) ? value : String(value || '');

  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmac(value, pepper) {
  return crypto.createHmac('sha256', pepper).update(String(value || '')).digest('hex');
}

function privateHash(value) {
  const pepper = config.email.code_hmac_pepper || config.jwt_secret;

  return hmac(value, pepper);
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');

  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, passwordHash) {
  const [algorithm, salt, expected] = String(passwordHash || '').split('$');

  if (algorithm !== 'scrypt' || !salt || !expected) {
    return false;
  }

  const actual = hashPassword(password, salt).split('$')[2];
  const expectedBuffer = Buffer.from(expected, 'hex');
  const actualBuffer = Buffer.from(actual, 'hex');

  return expectedBuffer.length === actualBuffer.length
    && crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

module.exports = {
  hashPassword,
  hmac,
  privateHash,
  sha256,
  verifyPassword,
};
