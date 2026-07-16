const lodash = require('lodash');
const { Op } = require('sequelize');
const Jwt = require('../utils/jwt');
const AuthSession = require('../models/auth_session');
const { sha256 } = require('../utils/security');
const config = require('../../config');

const setAuthUser = () => async (ctx, next) => {
  const token = ctx.query.token || ctx.request.headers['X-Token'] || ctx.request.headers['x-token'];

  ctx.state.auth_user = null;

  if (!lodash.isEmpty(token)) {
    const payload = Jwt.verifyToken(token);

    if (payload && payload.userId && !payload.sessionId) {
      ctx.state.auth_user = {
        id: payload.userId,
        source: 'token_legacy',
      };
    } else if (payload && payload.userId && payload.sessionId) {
      const session = await AuthSession.findOne({
        where: {
          id: payload.sessionId,
          user_id: payload.userId,
          token_hash: sha256(token),
          revoked_at: null,
          expires_at: { [Op.gt]: new Date() },
        },
      });
      if (session) {
        ctx.state.auth_user = {
          id: payload.userId,
          sessionId: payload.sessionId,
          source: 'token',
        };
        const lastSeen = session.last_seen_at ? new Date(session.last_seen_at).getTime() : 0;
        if (Date.now() - lastSeen > 5 * 60 * 1000) {
          AuthSession.update(
            { last_seen_at: new Date() },
            { where: { id: session.id } },
          ).catch(() => {});
        }
      }
    }
  }

  if (lodash.isNil(ctx.state.auth_user) && config.auth.allow_anonymous_desktop) {
    ctx.state.auth_user = {
      id: 'local-desktop',
      source: 'desktop',
    };
  }

  await next();
};

module.exports = setAuthUser;
