const crypto = require('crypto');
const { logger } = require('@honeykid/ml');
const { Op } = require('sequelize');
const { BadArgumentError, NotFoundError } = require('@honeykid/ml/errors');
const sequelize = require('../libs/sequelizor');
const {
  BillingOrder,
  MembershipPeriod,
  MembershipPlan,
  PaymentAttempt,
  PaymentEvent,
  PlanEntitlement,
  PointBatch,
  PointLedger,
} = require('../models/domain');
const AlipayService = require('../services/alipay');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');
const { sha256 } = require('../utils/security');
const EntitlementLogic = require('./entitlement');
const PointWallet = require('./point_wallet');
const config = require('../../config');
const {
  LedgerRangeDays,
  LedgerSourceFilters,
  OrderRangeDays,
  OrderStatusFilters,
  OrderTypeFilters,
  PlanRank,
  RechargePackages,
  membershipPlanSummary,
  rechargePackageSummaries,
} = require('./billing/catalog');
const {
  activeMembership,
  orderNo,
  pagination,
  planById,
  serializeOrder,
} = require('./billing/orders');
const { fulfillOrder: fulfillBillingOrder } = require('./billing/fulfillment');
const { handlePaymentCreationFailure } = require('./billing/payment_errors');

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

class BillingLogic {
  static async overview(userId) {
    const [wallet, entitlements, plans, expiring] = await Promise.all([
      PointWallet.balance(userId),
      EntitlementLogic.snapshot(userId),
      MembershipPlan.findAll({ where: { status: 'active' }, order: [['price_fen', 'ASC']] }),
      PointBatch.findAll({
        where: { user_id: userId, status: 'active', expires_at: { [Op.gt]: new Date() } },
        order: [['expires_at', 'ASC']],
        limit: 5,
      }),
    ]);
    const discount = entitlements.plan ? entitlements.plan.rechargeDiscountBps : 10000;

    return {
      wallet: {
        ...wallet,
        availablePoints: (Number(wallet.availableMicros) / 1000).toFixed(3).replace(/\.?0+$/, ''),
        expiring: expiring.map((batch) => ({
          amountMicros: String(batch.available_micros), expiresAt: batch.expires_at,
        })),
      },
      membership: {
        planCode: entitlements.plan ? entitlements.plan.code : 'free',
        ...entitlements.membership,
      },
      entitlements,
      plans: plans.map(membershipPlanSummary),
      rechargePackages: rechargePackageSummaries(discount),
    };
  }

  static async ledgers(userId, query) {
    const { page, pageSize } = pagination(query);
    let entryTypes = ['grant', 'consume'];
    if (query.direction === 'income') entryTypes = ['grant'];
    if (query.direction === 'expense') entryTypes = ['consume'];
    const where = {
      user_id: userId,
      entry_type: { [Op.in]: entryTypes },
    };
    const sourceFilter = LedgerSourceFilters[query.source];
    if (sourceFilter) where.business_type = sourceFilter;
    const rangeDays = Number(query.range_days);
    if (LedgerRangeDays.has(rangeDays)) {
      where.created_at = {
        [Op.gte]: new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000),
      };
    }
    const { rows, count } = await PointLedger.findAndCountAll({
      where,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      items: rows.map((row) => {
        const item = plain(row);
        return {
          id: item.id,
          type: item.entry_type,
          businessType: item.business_type,
          amountMicros: String(item.amount_micros),
          availableDeltaMicros: String(item.available_delta_micros),
          availableAfterMicros: String(item.account_available_after),
          expiresAt: item.expires_at_snapshot,
          createdAt: item.createdAt || item.created_at,
        };
      }),
      page,
      pageSize,
      total: count,
    };
  }

  static async upgradeQuote(userId, productCode) {
    const period = await activeMembership(userId);
    if (!period) throw new BadArgumentError('当前没有可升级的会员周期');
    const [currentPlan, targetPlan, pending] = await Promise.all([
      planById(period.plan_id),
      MembershipPlan.findOne({ where: { code: productCode, status: 'active' } }).then(plain),
      MembershipPeriod.count({ where: { user_id: userId, status: 'pending' } }),
    ]);
    if (pending) {
      throw new BusinessError(
        409,
        ErrorCodes.PENDING_RENEWAL_EXISTS,
        '已有待生效续费，当前周期不能升级',
      );
    }
    if (!targetPlan || PlanRank[targetPlan.code] <= PlanRank[currentPlan.code]) {
      throw new BadArgumentError('请选择更高等级的会员');
    }
    const remainingMilliseconds = new Date(period.ends_at).getTime() - Date.now();
    const remainingSeconds = Math.max(0, Math.floor(remainingMilliseconds / 1000));
    const cycleSeconds = 30 * 24 * 60 * 60;

    return {
      fromPlanCode: currentPlan.code,
      toPlanCode: targetPlan.code,
      endsAt: period.ends_at,
      remainingSeconds,
      payAmountFen: Math.ceil(
        ((targetPlan.price_fen - currentPlan.price_fen) * remainingSeconds) / cycleSeconds,
      ),
      grantMicros: String(Math.floor(
        ((Number(targetPlan.grant_micros) - Number(currentPlan.grant_micros))
          * remainingSeconds) / cycleSeconds,
      )),
    };
  }

  static async createOrder(userId, entries) {
    const existing = await BillingOrder.findOne({
      where: { user_id: userId, client_request_id: entries.client_request_id },
    });
    if (existing) return serializeOrder(existing);

    return sequelize.transaction(async (transaction) => {
      let snapshot;
      let type = entries.order_type;
      let listAmount;
      let discountBps = 10000;
      let payAmount;

      if (type === 'recharge') {
        const product = RechargePackages[entries.product_code];
        if (!product) throw new BadArgumentError('充值产品不存在');
        const entitlement = await EntitlementLogic.snapshot(userId);
        discountBps = entitlement.plan ? entitlement.plan.rechargeDiscountBps : 10000;
        listAmount = product.amountFen;
        payAmount = Math.ceil((listAmount * discountBps) / 10000);
        snapshot = {
          schema_version: 1,
          product_code: entries.product_code,
          name_zh: product.name,
          name_en: product.nameEn,
          grant_micros: String(product.pointsMicros),
          validity_years: 2,
          recharge_discount_bps: discountBps,
        };
      } else {
        const targetPlan = plain(await MembershipPlan.findOne({
          where: { code: entries.product_code, status: 'active' }, transaction,
        }));
        if (!targetPlan || targetPlan.code === 'free') throw new BadArgumentError('会员产品不存在');
        const period = await activeMembership(userId, transaction, true);
        const currentPlan = period ? await planById(period.plan_id, transaction) : null;
        const capabilities = (await PlanEntitlement.findAll({
          where: { plan_id: targetPlan.id }, transaction,
        })).filter((item) => item.allowed).map((item) => item.capability_code);
        listAmount = targetPlan.price_fen;
        payAmount = listAmount;
        type = period && currentPlan.code === targetPlan.code ? 'renewal' : 'membership';
        let upgradeGrantMicros = null;

        if (period && PlanRank[targetPlan.code] < PlanRank[currentPlan.code]) {
          throw new BadArgumentError('当前周期内不支持降级');
        }
        if (period && PlanRank[targetPlan.code] > PlanRank[currentPlan.code]) {
          const pending = await MembershipPeriod.count({
            where: { user_id: userId, status: 'pending' },
            transaction,
          });
          if (pending) {
            throw new BusinessError(
              409,
              ErrorCodes.PENDING_RENEWAL_EXISTS,
              '已有待生效续费，当前周期不能升级',
            );
          }
          const remainingMs = new Date(period.ends_at).getTime() - Date.now();
          const remainingSeconds = Math.max(0, Math.floor(remainingMs / 1000));
          const cycleSeconds = 30 * 24 * 60 * 60;
          type = 'upgrade';
          payAmount = Math.ceil(
            ((targetPlan.price_fen - currentPlan.price_fen) * remainingSeconds)
              / cycleSeconds,
          );
          upgradeGrantMicros = String(Math.floor(
            ((Number(targetPlan.grant_micros) - Number(currentPlan.grant_micros))
              * remainingSeconds) / cycleSeconds,
          ));
        }
        snapshot = {
          schema_version: 1,
          product_code: targetPlan.code,
          name_zh: targetPlan.name_zh,
          name_en: targetPlan.name_en,
          plan_id: targetPlan.id,
          plan_code: targetPlan.code,
          plan_version: targetPlan.version,
          cycle_days: targetPlan.cycle_days,
          grant_micros: String(targetPlan.grant_micros),
          upgrade_grant_micros: upgradeGrantMicros,
          capabilities,
        };
      }

      const order = await BillingOrder.create({
        id: crypto.randomUUID(),
        order_no: orderNo(),
        user_id: userId,
        order_type: type,
        product_code: entries.product_code,
        product_snapshot: snapshot,
        currency: 'CNY',
        list_amount_fen: listAmount,
        discount_bps: discountBps,
        pay_amount_fen: payAmount,
        status: 'created',
        client_request_id: entries.client_request_id,
        expires_at: new Date(Date.now() + config.payment.order_ttl_seconds * 1000),
      }, { transaction });

      return serializeOrder(order);
    });
  }

  static async listOrders(userId, query) {
    const { page, pageSize } = pagination(query);
    const where = { user_id: userId };
    const orderType = Object.prototype.hasOwnProperty.call(OrderTypeFilters, query.order_type)
      ? OrderTypeFilters[query.order_type] : null;
    const status = Object.prototype.hasOwnProperty.call(OrderStatusFilters, query.status)
      ? OrderStatusFilters[query.status] : null;
    if (orderType) where.order_type = orderType;
    if (query.status === 'pending') {
      where.status = { [Op.in]: ['created', 'paying'] };
      where.expires_at = { [Op.gt]: new Date() };
    } else if (query.status === 'expired') {
      where.status = { [Op.in]: ['created', 'paying'] };
      where.expires_at = { [Op.lte]: new Date() };
    } else if (status) {
      where.status = status;
    }

    const createdAt = {};
    const rangeDays = Number(query.range_days);
    if (OrderRangeDays.has(rangeDays)) {
      createdAt[Op.gte] = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    }
    if (Reflect.ownKeys(createdAt).length) where.created_at = createdAt;

    const { rows, count } = await BillingOrder.findAndCountAll({
      where,
      limit: pageSize,
      offset: (page - 1) * pageSize,
      order: [['created_at', 'DESC'], ['id', 'DESC']],
    });

    return {
      items: rows.map(serializeOrder),
      page,
      pageSize,
      total: count,
    };
  }

  static async getOrder(userId, orderId) {
    let order = plain(await BillingOrder.findOne({ where: { id: orderId, user_id: userId } }));
    if (!order) throw new NotFoundError('订单不存在');
    if (order.status === 'paying') {
      try {
        await BillingLogic.reconcilePayment(order);
        order = plain(await BillingOrder.findOne({ where: { id: orderId, user_id: userId } }));
      } catch (error) {
        const kind = AlipayService.classifyError(error);
        logger.warn(`Alipay trade query failed (${kind}): ${error.message}`);
      }
    }

    return serializeOrder(order);
  }

  static async reconcilePayment(order) {
    if (!order.active_payment_attempt_id) return;
    const cutoff = new Date(Date.now() - config.payment.reconcile_interval_seconds * 1000);
    const [claimed] = await PaymentAttempt.update({
      last_queried_at: new Date(),
      query_count: sequelize.literal('query_count + 1'),
    }, {
      where: {
        id: order.active_payment_attempt_id,
        status: 'pending',
        [Op.or]: [
          { last_queried_at: null },
          { last_queried_at: { [Op.lte]: cutoff } },
        ],
      },
    });
    if (!claimed) return;

    const attempt = plain(await PaymentAttempt.findOne({
      where: { id: order.active_payment_attempt_id },
    }));
    const result = await AlipayService.queryTrade(attempt.provider_order_id);
    if (result.tradeStatus === 'pending') return;

    await sequelize.transaction(async (transaction) => {
      const lockedAttempt = plain(await PaymentAttempt.findOne({
        where: { id: attempt.id }, transaction, lock: transaction.LOCK.UPDATE,
      }));
      const lockedOrder = plain(await BillingOrder.findOne({
        where: { id: order.id }, transaction, lock: transaction.LOCK.UPDATE,
      }));
      if (!lockedAttempt || !lockedOrder || lockedOrder.status === 'paid') return;

      if (result.tradeStatus === 'closed') {
        await PaymentAttempt.update({
          status: 'closed', active_order_guard: null, checkout_value: null, closed_at: new Date(),
        }, { where: { id: lockedAttempt.id }, transaction });
        await BillingOrder.update({
          status: 'closed', active_payment_attempt_id: null, closed_at: new Date(),
        }, { where: { id: lockedOrder.id }, transaction });
        return;
      }

      if (result.providerOrderId !== lockedAttempt.provider_order_id
        || result.amountFen !== Number(lockedOrder.pay_amount_fen)) {
        await PaymentAttempt.update({
          status: 'failed', active_order_guard: null, error_code: 'query_mismatch',
        }, { where: { id: lockedAttempt.id }, transaction });
        await BillingOrder.update({
          status: 'failed', active_payment_attempt_id: null, failure_code: 'payment_mismatch',
        }, { where: { id: lockedOrder.id }, transaction });
        return;
      }

      const now = new Date();
      const eventKey = sha256(`alipay|query|${lockedAttempt.provider_order_id}|succeeded`);
      await PaymentEvent.findOrCreate({
        where: { provider: 'alipay', event_key: eventKey },
        defaults: {
          id: crypto.randomUUID(),
          provider: 'alipay',
          event_key: eventKey,
          provider_event_id: null,
          provider_order_id: lockedAttempt.provider_order_id,
          order_id: lockedOrder.id,
          attempt_id: lockedAttempt.id,
          event_type: 'QUERY_TRADE_SUCCESS',
          trade_status: 'succeeded',
          currency: 'CNY',
          amount_fen: result.amountFen,
          payload_digest: sha256(JSON.stringify(result)),
          process_status: 'processed',
          rejection_code: null,
          safe_metadata_json: { providerTradeId: result.providerTradeId },
          received_at: now,
          processed_at: now,
        },
        transaction,
      });
      await PaymentAttempt.update({
        status: 'succeeded', active_order_guard: null, checkout_value: null, paid_at: now,
      }, { where: { id: lockedAttempt.id }, transaction });
      await BillingOrder.update({ status: 'paid', paid_at: now }, {
        where: { id: lockedOrder.id }, transaction,
      });
      await fulfillBillingOrder(lockedOrder, transaction);
    });
  }

  static async createPayment(userId, orderId, clientRequestId) {
    const order = plain(await BillingOrder.findOne({ where: { id: orderId, user_id: userId } }));
    if (!order) throw new NotFoundError('订单不存在');
    if (order.status === 'paid') return BillingLogic.getOrder(userId, orderId);
    if (!AlipayService.isConfigured()) {
      throw new BusinessError(
        503,
        ErrorCodes.PAYMENT_NOT_CONFIGURED,
        '支付服务尚未配置，请联系管理员',
      );
    }
    if (!['created', 'paying'].includes(order.status) || new Date(order.expires_at) <= new Date()) {
      throw new BusinessError(409, ErrorCodes.ORDER_STATE_CONFLICT, '订单状态已变化，请刷新');
    }
    const active = plain(await PaymentAttempt.findOne({
      where: { order_id: order.id, status: { [Op.in]: ['created', 'pending'] } },
    }));
    if (active && active.checkout_value) {
      return {
        attemptId: active.id,
        checkoutType: active.checkout_type,
        checkoutValue: active.checkout_value,
        expiresAt: active.expires_at,
      };
    }

    const attempt = active || plain(await PaymentAttempt.create({
      id: crypto.randomUUID(),
      order_id: order.id,
      client_request_id: clientRequestId,
      provider: config.payment.provider,
      provider_order_id: `${order.order_no}${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
      status: 'created',
      checkout_type: 'checkout_url',
      active_order_guard: order.id,
      expires_at: order.expires_at,
    }));
    await BillingOrder.update({
      status: 'paying', payment_provider: config.payment.provider, active_payment_attempt_id: attempt.id,
    }, { where: { id: order.id } });

    try {
      const checkout = AlipayService.createWebsitePayment({
        providerOrderId: attempt.provider_order_id,
        amountFen: order.pay_amount_fen,
        subject: `Marketing Master - ${order.product_snapshot.name_zh}`,
        expiresInSeconds: Math.max(
          60,
          Math.floor((new Date(order.expires_at) - Date.now()) / 1000),
        ),
      });
      await PaymentAttempt.update({
        status: 'pending',
        checkout_type: checkout.checkoutType,
        checkout_value: checkout.checkoutValue,
        provider_created_at: new Date(),
      }, { where: { id: attempt.id } });

      return {
        attemptId: attempt.id,
        checkoutType: checkout.checkoutType,
        checkoutValue: checkout.checkoutValue,
        expiresAt: attempt.expires_at,
      };
    } catch (error) {
      await handlePaymentCreationFailure(error, attempt.id, order.id);
    }
  }

  static async closeOrder(userId, orderId) {
    const order = plain(await BillingOrder.findOne({
      where: { id: orderId, user_id: userId },
    }));
    if (!order) throw new NotFoundError('订单不存在');
    if (order.status === 'paid') {
      throw new BusinessError(409, ErrorCodes.ORDER_STATE_CONFLICT, '订单已支付');
    }
    const attempt = order.active_payment_attempt_id
      ? plain(await PaymentAttempt.findOne({
        where: { id: order.active_payment_attempt_id },
      })) : null;
    if (attempt && ['created', 'pending'].includes(attempt.status)) {
      await AlipayService.closeTrade(attempt.provider_order_id);
      await PaymentAttempt.update({
        status: 'closed', active_order_guard: null, checkout_value: null, closed_at: new Date(),
      }, { where: { id: attempt.id } });
    }
    await BillingOrder.update({ status: 'closed', closed_at: new Date() }, { where: { id: order.id } });

    return BillingLogic.getOrder(userId, orderId);
  }

  static async paymentCallback(provider, body) {
    if (provider !== 'alipay') return false;
    const verified = AlipayService.verifyNotification(body);
    if (!verified.valid) return false;
    const sortedPayload = Object.keys(body).sort().map((key) => [key, body[key]]);
    const payloadDigest = sha256(JSON.stringify(sortedPayload));
    const fallbackEvent = [
      verified.providerOrderId,
      verified.tradeStatus,
      'CNY',
      verified.amountFen,
    ].join('|');
    const eventKey = sha256(`alipay|${verified.eventId || fallbackEvent}`);

    return sequelize.transaction(async (transaction) => {
      const existing = await PaymentEvent.findOne({
        where: { provider: 'alipay', event_key: eventKey }, transaction,
      });
      if (existing) return true;
      const attempt = plain(await PaymentAttempt.findOne({
        where: { provider: 'alipay', provider_order_id: verified.providerOrderId },
        transaction,
        lock: transaction.LOCK.UPDATE,
      }));
      const order = attempt ? plain(await BillingOrder.findOne({
        where: { id: attempt.order_id }, transaction, lock: transaction.LOCK.UPDATE,
      })) : null;
      let rejection = null;
      if (!order) rejection = 'order_not_found';
      else if (order.currency !== verified.currency) rejection = 'currency_mismatch';
      else if (Number(order.pay_amount_fen) !== verified.amountFen) rejection = 'amount_mismatch';
      const event = await PaymentEvent.create({
        id: crypto.randomUUID(),
        provider: 'alipay',
        event_key: eventKey,
        provider_event_id: verified.eventId,
        provider_order_id: verified.providerOrderId,
        order_id: order ? order.id : null,
        attempt_id: attempt ? attempt.id : null,
        event_type: verified.eventType,
        trade_status: verified.tradeStatus,
        currency: verified.currency,
        amount_fen: verified.amountFen,
        payload_digest: payloadDigest,
        process_status: rejection ? 'rejected' : 'received',
        rejection_code: rejection,
        safe_metadata_json: { providerTradeId: verified.providerTradeId },
        received_at: new Date(),
      }, { transaction });
      if (rejection) return false;

      if (verified.tradeStatus === 'succeeded' && order.status !== 'paid') {
        await PaymentAttempt.update({
          status: 'succeeded', active_order_guard: null, checkout_value: null, paid_at: new Date(),
        }, { where: { id: attempt.id }, transaction });
        await BillingOrder.update({ status: 'paid', paid_at: new Date() }, {
          where: { id: order.id }, transaction,
        });
        await fulfillBillingOrder(order, transaction);
      }
      await PaymentEvent.update({ process_status: 'processed', processed_at: new Date() }, {
        where: { id: event.id }, transaction,
      });

      return true;
    });
  }

  static async fulfillOrder(order, transaction) {
    await fulfillBillingOrder(order, transaction);
  }
}

BillingLogic.RechargePackages = RechargePackages;

module.exports = BillingLogic;
