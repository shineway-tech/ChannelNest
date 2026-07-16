const BillingLogic = require('../../../logics/billing');

class BillingController {
  async overview(ctx, next) {
    ctx.setData(await BillingLogic.overview(ctx.state.auth_user.id));
    await next();
  }

  async ledgers(ctx, next) {
    ctx.setData(await BillingLogic.ledgers(ctx.state.auth_user.id, ctx.query));
    await next();
  }

  async upgradeQuote(ctx, next) {
    ctx.setData(await BillingLogic.upgradeQuote(
      ctx.state.auth_user.id,
      ctx.state.entries.product_code,
    ));
    await next();
  }

  async createOrder(ctx, next) {
    ctx.setData(await BillingLogic.createOrder(ctx.state.auth_user.id, ctx.state.entries));
    await next();
  }

  async orders(ctx, next) {
    ctx.setData(await BillingLogic.listOrders(ctx.state.auth_user.id, ctx.query));
    await next();
  }

  async order(ctx, next) {
    ctx.setData(await BillingLogic.getOrder(ctx.state.auth_user.id, ctx.params.order_id));
    await next();
  }

  async payment(ctx, next) {
    ctx.setData(await BillingLogic.createPayment(
      ctx.state.auth_user.id,
      ctx.params.order_id,
      ctx.state.entries.client_request_id,
    ));
    await next();
  }

  async close(ctx, next) {
    ctx.setData(await BillingLogic.closeOrder(ctx.state.auth_user.id, ctx.params.order_id));
    await next();
  }

  async callback(ctx) {
    const accepted = await BillingLogic.paymentCallback(
      ctx.params.provider,
      ctx.request.body || {},
    );
    ctx.status = accepted ? 200 : 400;
    ctx.body = accepted ? 'success' : 'failure';
  }
}

module.exports = new BillingController();
