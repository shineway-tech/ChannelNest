const EntitlementLogic = require('../logics/entitlement');

const requireEntitlement = (capability) => async (ctx, next) => {
  await EntitlementLogic.require(ctx.state.auth_user.id, capability);
  await next();
};

module.exports = requireEntitlement;
