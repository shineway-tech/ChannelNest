const crypto = require('crypto');
const { Op } = require('sequelize');
const { UserMessage } = require('../models/domain');
const config = require('../../config');

const Templates = {
  signup_gift: {
    zh: ['注册积分已到账', '已赠送 100 积分，有效期 30 天。'],
    en: ['Welcome points received', '100 points have been added and are valid for 30 days.'],
  },
  payment_succeeded: {
    zh: ['支付成功', '订单 {orderNo} 已支付并完成发放。'],
    en: ['Payment complete', 'Order {orderNo} has been paid and fulfilled.'],
  },
  ai_completed: {
    zh: ['生成完成', '你的 AI 内容已经生成完成。'],
    en: ['Generation complete', 'Your AI content is ready.'],
  },
  ai_failed: {
    zh: ['生成未完成', '本次生成失败，冻结积分已退回。'],
    en: ['Generation failed', 'Generation failed and held points were returned.'],
  },
};

function render(text, params) {
  return Object.entries(params || {}).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    text,
  );
}

function serialize(row, language) {
  const data = row.toJSON ? row.toJSON() : row;
  const template = Templates[data.template_code] || {
    zh: [data.template_code, ''], en: [data.template_code, ''],
  };
  const copy = template[language === 'en' ? 'en' : 'zh'];

  return {
    id: data.id,
    category: data.category,
    level: data.level,
    templateCode: data.template_code,
    title: render(copy[0], data.template_params),
    body: render(copy[1], data.template_params),
    actionCode: data.action_code,
    actionRefId: data.action_ref_id,
    readAt: data.read_at,
    createdAt: data.createdAt || data.created_at,
  };
}

class MessageLogic {
  static async create(input, transaction = null) {
    const [message] = await UserMessage.findOrCreate({
      where: { user_id: input.userId, dedupe_key: input.dedupeKey },
      defaults: {
        id: crypto.randomUUID(),
        user_id: input.userId,
        category: input.category,
        level: input.level || 'info',
        template_code: input.templateCode,
        template_params: input.templateParams || {},
        action_code: input.actionCode || null,
        action_ref_id: input.actionRefId || null,
        dedupe_key: input.dedupeKey,
        expires_at: new Date(Date.now() + config.messages.retention_days * 24 * 60 * 60 * 1000),
      },
      transaction,
    });

    return message;
  }

  static async list(userId, query) {
    const limit = Math.min(Number(query.limit || 30), 50);
    const where = { user_id: userId, expires_at: { [Op.gt]: new Date() } };
    if (query.unread_only === 'true') where.read_at = null;
    if (query.cursor) {
      const [createdAt, id] = Buffer.from(query.cursor, 'base64url').toString().split('|');
      where[Op.or] = [
        { createdAt: { [Op.lt]: new Date(createdAt) } },
        { createdAt: new Date(createdAt), id: { [Op.lt]: id } },
      ];
    }
    const rows = await UserMessage.findAll({
      where, limit: limit + 1, order: [['created_at', 'DESC'], ['id', 'DESC']],
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit);
    const last = items[items.length - 1];

    return {
      items: items.map((row) => serialize(row, query.language)),
      nextCursor: hasMore && last
        ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString('base64url') : null,
    };
  }

  static async unreadCount(userId) {
    const count = await UserMessage.count({
      where: { user_id: userId, read_at: null, expires_at: { [Op.gt]: new Date() } },
    });

    return { count };
  }

  static async markRead(userId, messageId) {
    await UserMessage.update({ read_at: new Date() }, {
      where: { id: messageId, user_id: userId, read_at: null },
    });

    return MessageLogic.unreadCount(userId);
  }

  static async markAllRead(userId) {
    await UserMessage.update({ read_at: new Date() }, {
      where: { user_id: userId, read_at: null },
    });

    return { count: 0 };
  }
}

module.exports = MessageLogic;
