const AuthUser = require('../models/auth_user');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');

const requireRegisteredUser = ({ requireEmail = false } = {}) => async (ctx, next) => {
  const identity = ctx.state.auth_user;

  if (!identity || identity.source !== 'token' || !identity.sessionId) {
    throw new BusinessError(401, ErrorCodes.REGISTERED_LOGIN_REQUIRED, '请先登录');
  }
  const user = await AuthUser.findOne({ where: { id: identity.id, status: 'active' } });
  if (!user) {
    throw new BusinessError(401, ErrorCodes.SESSION_REVOKED, '登录状态已失效，请重新登录');
  }
  if (requireEmail && (!user.email || !user.email_verified_at)) {
    throw new BusinessError(403, ErrorCodes.EMAIL_UNVERIFIED, '请先绑定并验证邮箱');
  }

  ctx.state.registered_user = user.toJSON();
  await next();
};

module.exports = requireRegisteredUser;
