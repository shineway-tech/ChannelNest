const AuthLogic = require('../../../logics/auth');

function requestMeta(ctx) {
  return { ip: ctx.ip, userAgent: ctx.get('user-agent') };
}

class AuthController {
  async captcha(ctx, next) {
    const ret = await AuthLogic.captcha();

    ctx.setData(ret);
    await next();
  }

  async register(ctx, next) {
    const ret = await AuthLogic.register(ctx.state.entries, requestMeta(ctx));

    ctx.setData(ret);
    await next();
  }

  async login(ctx, next) {
    const ret = await AuthLogic.login(ctx.state.entries, requestMeta(ctx));

    ctx.setData(ret);
    await next();
  }

  async emailCode(ctx, next) {
    const ret = await AuthLogic.sendEmailCode(
      ctx.state.entries,
      requestMeta(ctx),
      ctx.state.auth_user,
    );
    ctx.setData(ret);
    await next();
  }

  async logout(ctx, next) {
    ctx.setData(await AuthLogic.logout(ctx.state.auth_user));
    await next();
  }

  async bindEmail(ctx, next) {
    ctx.setData(await AuthLogic.bindEmail(ctx.state.auth_user.id, ctx.state.entries));
    await next();
  }

  async resetPassword(ctx, next) {
    ctx.setData(await AuthLogic.resetPassword(ctx.state.entries));
    await next();
  }

  async me(ctx, next) {
    const ret = await AuthLogic.me(ctx.state.auth_user.id);

    ctx.setData(ret);
    await next();
  }

  async updateProfile(ctx, next) {
    const ret = await AuthLogic.updateProfile(ctx.state.auth_user.id, ctx.state.entries);

    ctx.setData(ret);
    await next();
  }

  async updatePassword(ctx, next) {
    const ret = await AuthLogic.updatePassword(ctx.state.auth_user.id, ctx.state.entries);

    ctx.setData(ret);
    await next();
  }
}

module.exports = new AuthController();
