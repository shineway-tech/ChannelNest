const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  MembershipEvent,
  MembershipPeriod,
} = require('../../models/domain');
const MessageLogic = require('../message');
const PointWallet = require('../point_wallet');
const { activeMembership, plain } = require('./orders');

async function fulfillOrder(order, transaction) {
  const snapshot = order.product_snapshot;
  if (order.order_type === 'recharge') {
    const expiresAt = new Date();
    expiresAt.setFullYear(expiresAt.getFullYear() + 2);
    await PointWallet.grant({
      userId: order.user_id,
      sourceType: 'recharge',
      sourceId: order.id,
      amountMicros: snapshot.grant_micros,
      expiresAt,
      spendPriority: 20,
    }, transaction);
  } else if (order.order_type === 'upgrade') {
    const period = await activeMembership(order.user_id, transaction, true);
    if (!period) throw new Error('Active membership period not found for upgrade');
    const eventId = crypto.randomUUID();
    const delta = Number(snapshot.upgrade_grant_micros || 0);
    await MembershipPeriod.update({ plan_id: snapshot.plan_id }, {
      where: { id: period.id }, transaction,
    });
    await MembershipEvent.create({
      id: eventId,
      user_id: order.user_id,
      period_id: period.id,
      event_type: 'upgraded',
      from_plan_id: period.plan_id,
      to_plan_id: snapshot.plan_id,
      source_order_id: order.id,
      delta_grant_micros: delta,
      effective_at: new Date(),
      dedupe_key: `upgrade:${order.id}`,
      metadata_json: {},
    }, { transaction });
    if (delta > 0) {
      await PointWallet.grant({
        userId: order.user_id,
        sourceType: 'membership_upgrade_gift',
        sourceId: eventId,
        amountMicros: delta,
        expiresAt: period.ends_at,
        spendPriority: 10,
      }, transaction);
    }
  } else {
    const lastPeriod = plain(await MembershipPeriod.findOne({
      where: { user_id: order.user_id, status: { [Op.in]: ['active', 'pending'] } },
      order: [['ends_at', 'DESC']],
      transaction,
      lock: transaction.LOCK.UPDATE,
    }));
    const now = new Date();
    const startsAt = lastPeriod && new Date(lastPeriod.ends_at) > now
      ? new Date(lastPeriod.ends_at) : now;
    const cycleMilliseconds = snapshot.cycle_days * 24 * 60 * 60 * 1000;
    const endsAt = new Date(startsAt.getTime() + cycleMilliseconds);
    const isActive = startsAt <= now;
    const periodId = crypto.randomUUID();
    await MembershipPeriod.create({
      id: periodId,
      user_id: order.user_id,
      plan_id: snapshot.plan_id,
      source_order_id: order.id,
      status: isActive ? 'active' : 'pending',
      starts_at: startsAt,
      ends_at: endsAt,
      active_user_guard: isActive ? order.user_id : null,
      activated_at: isActive ? now : null,
    }, { transaction });
    let grantBatchId = null;
    if (isActive) {
      const batch = await PointWallet.grant({
        userId: order.user_id,
        sourceType: 'membership_gift',
        sourceId: periodId,
        amountMicros: snapshot.grant_micros,
        expiresAt: endsAt,
        spendPriority: 10,
      }, transaction);
      grantBatchId = batch.id;
      await MembershipPeriod.update({ grant_batch_id: grantBatchId }, {
        where: { id: periodId }, transaction,
      });
    }
    await MembershipEvent.create({
      id: crypto.randomUUID(),
      user_id: order.user_id,
      period_id: periodId,
      event_type: isActive ? 'activated' : 'renewal_scheduled',
      to_plan_id: snapshot.plan_id,
      source_order_id: order.id,
      effective_at: startsAt,
      dedupe_key: `membership:${order.id}`,
      metadata_json: { grantBatchId },
    }, { transaction });
  }

  await MessageLogic.create({
    userId: order.user_id,
    category: 'billing',
    level: 'success',
    templateCode: 'payment_succeeded',
    templateParams: { orderNo: order.order_no },
    actionCode: 'open_order',
    actionRefId: order.id,
    dedupeKey: `payment:${order.id}:paid`,
  }, transaction);
}

module.exports = {
  fulfillOrder,
};
