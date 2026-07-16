const EntitlementLogic = require('../../../logics/entitlement');

class EntitlementsController {
  async index(ctx, next) {
    ctx.setData(await EntitlementLogic.snapshot(ctx.state.auth_user.id));
    await next();
  }

  async check(ctx, next) {
    ctx.setData(await EntitlementLogic.check(
      ctx.state.auth_user.id,
      ctx.state.entries.capability_code,
    ));
    await next();
  }
}

module.exports = new EntitlementsController();
