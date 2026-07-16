const MessageLogic = require('../../../logics/message');

class MessagesController {
  async list(ctx, next) {
    ctx.setData(await MessageLogic.list(ctx.state.auth_user.id, ctx.query));
    await next();
  }

  async unreadCount(ctx, next) {
    ctx.setData(await MessageLogic.unreadCount(ctx.state.auth_user.id));
    await next();
  }

  async read(ctx, next) {
    ctx.setData(await MessageLogic.markRead(ctx.state.auth_user.id, ctx.params.message_id));
    await next();
  }

  async readAll(ctx, next) {
    ctx.setData(await MessageLogic.markAllRead(ctx.state.auth_user.id));
    await next();
  }
}

module.exports = new MessagesController();
