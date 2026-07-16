const jwt = require('jsonwebtoken');
const lodash = require('lodash');
const config = require('../../config');

class Jwt {
  static getSecret() {
    return lodash.get(config, 'jwt_secret.channel_nest_api')
      || lodash.get(config, 'jwt_secret.default')
      || config.jwt_secret;
  }

  static generateToken(userId, sessionId, ttl) {
    return jwt.sign({ user_id: userId }, Jwt.getSecret(), { expiresIn: ttl, jwtid: sessionId });
  }

  static getTokenName() {
    let name = 'channel_nest_api_token';

    if (config.env === 'staging') {
      name = `${name}_staging`;
    }

    return name;
  }

  static verifyToken(token) {
    if (lodash.isNil(token)) {
      return null;
    }

    try {
      const result = jwt.verify(token, Jwt.getSecret(), { ignoreExpiration: false });

      return {
        userId: lodash.get(result, 'user_id', null),
        sessionId: lodash.get(result, 'jti', null),
        expiresAt: lodash.get(result, 'exp', 0) * 1000,
      };
    } catch (e) {
      return null;
    }
  }
}

module.exports = Jwt;
