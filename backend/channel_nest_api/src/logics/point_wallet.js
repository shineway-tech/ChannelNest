/* eslint-disable no-await-in-loop */
const crypto = require('crypto');
const { Op } = require('sequelize');
const sequelize = require('../libs/sequelizor');
const {
  PointAccount,
  PointBatch,
  PointHold,
  PointHoldItem,
  PointLedger,
} = require('../models/domain');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');

const SignupGiftMicros = 100000;

function value(number) {
  return BigInt(String(number || 0));
}

function dbValue(number) {
  return number.toString();
}

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

async function inTransaction(transaction, callback) {
  if (transaction) return callback(transaction);
  return sequelize.transaction(callback);
}

function ledgerSnapshot(input) {
  return {
    id: crypto.randomUUID(),
    entry_key: input.entryKey,
    user_id: input.userId,
    batch_id: input.batch ? input.batch.id : null,
    hold_id: input.holdId || null,
    entry_type: input.entryType,
    business_type: input.businessType,
    business_id: input.businessId,
    amount_micros: dbValue(input.amount),
    available_delta_micros: dbValue(input.availableDelta),
    frozen_delta_micros: dbValue(input.frozenDelta),
    consumed_delta_micros: dbValue(input.consumedDelta || 0n),
    expired_delta_micros: '0',
    account_available_after: dbValue(input.accountAvailable),
    account_frozen_after: dbValue(input.accountFrozen),
    batch_available_after: input.batch ? dbValue(value(input.batch.available_micros)) : null,
    batch_frozen_after: input.batch ? dbValue(value(input.batch.frozen_micros)) : null,
    batch_consumed_after: input.batch ? dbValue(value(input.batch.consumed_micros)) : null,
    batch_expired_after: input.batch ? dbValue(value(input.batch.expired_micros)) : null,
    expires_at_snapshot: input.batch ? input.batch.expires_at : null,
    metadata_json: input.metadata || {},
  };
}

class PointWallet {
  static async ensureAccount(userId, transaction) {
    const [account] = await PointAccount.findOrCreate({
      where: { user_id: userId },
      defaults: { user_id: userId },
      transaction,
    });

    return account;
  }

  static async grantSignupGift(userId, transaction = null) {
    return PointWallet.grant({
      userId,
      sourceType: 'signup_gift',
      sourceId: userId,
      amountMicros: SignupGiftMicros,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      spendPriority: 10,
    }, transaction);
  }

  static async grant(input, transaction = null) {
    return inTransaction(transaction, async (tx) => {
      const existing = await PointBatch.findOne({
        where: { user_id: input.userId, source_type: input.sourceType, source_id: input.sourceId },
        transaction: tx,
      });
      if (existing) return plain(existing);

      await PointWallet.ensureAccount(input.userId, tx);
      const account = plain(await PointAccount.findOne({
        where: { user_id: input.userId }, transaction: tx, lock: tx.LOCK.UPDATE,
      }));
      const amount = value(input.amountMicros);
      const availableAfter = value(account.available_micros) + amount;
      const batch = plain(await PointBatch.create({
        id: crypto.randomUUID(),
        user_id: input.userId,
        source_type: input.sourceType,
        source_id: input.sourceId,
        spend_priority: input.spendPriority,
        total_micros: dbValue(amount),
        available_micros: dbValue(amount),
        expires_at: input.expiresAt,
        status: 'active',
      }, { transaction: tx }));

      await PointAccount.update({
        available_micros: dbValue(availableAfter),
        version: dbValue(value(account.version) + 1n),
      }, { where: { user_id: input.userId }, transaction: tx });
      await PointLedger.create(ledgerSnapshot({
        entryKey: `grant:${input.sourceType}:${input.sourceId}:${batch.id}:1`,
        userId: input.userId,
        batch,
        entryType: 'grant',
        businessType: input.sourceType,
        businessId: input.sourceId,
        amount,
        availableDelta: amount,
        frozenDelta: 0n,
        accountAvailable: availableAfter,
        accountFrozen: value(account.frozen_micros),
      }), { transaction: tx });

      return batch;
    });
  }

  static async freeze(input, transaction = null) {
    return inTransaction(transaction, async (tx) => {
      const existing = await PointHold.findOne({
        where: {
          user_id: input.userId,
          business_type: input.businessType,
          business_id: input.businessId,
        },
        transaction: tx,
      });
      if (existing) return plain(existing);

      await PointWallet.ensureAccount(input.userId, tx);
      const account = plain(await PointAccount.findOne({
        where: { user_id: input.userId }, transaction: tx, lock: tx.LOCK.UPDATE,
      }));
      const total = value(input.amountMicros);
      if (value(account.available_micros) < total) {
        throw new BusinessError(409, ErrorCodes.INSUFFICIENT_POINTS, '积分不足，请先充值');
      }

      const batches = (await PointBatch.findAll({
        where: {
          user_id: input.userId,
          status: 'active',
          available_micros: { [Op.gt]: 0 },
          expires_at: { [Op.gt]: new Date() },
        },
        order: [['spend_priority', 'ASC'], ['expires_at', 'ASC'], ['created_at', 'ASC'], ['id', 'ASC']],
        transaction: tx,
        lock: tx.LOCK.UPDATE,
      })).map(plain);

      const hold = plain(await PointHold.create({
        id: crypto.randomUUID(),
        user_id: input.userId,
        business_type: input.businessType,
        business_id: input.businessId,
        total_micros: dbValue(total),
        status: 'active',
        expires_at: input.expiresAt,
      }, { transaction: tx }));
      let remaining = total;
      let sequence = 0;
      const accountAvailable = value(account.available_micros) - total;
      const accountFrozen = value(account.frozen_micros) + total;

      for (const batch of batches) {
        if (remaining === 0n) break;
        const allocated = value(batch.available_micros) < remaining
          ? value(batch.available_micros) : remaining;
        const batchAvailable = value(batch.available_micros) - allocated;
        const batchFrozen = value(batch.frozen_micros) + allocated;
        const updatedBatch = {
          ...batch,
          available_micros: batchAvailable,
          frozen_micros: batchFrozen,
        };
        sequence += 1;

        await PointBatch.update({
          available_micros: dbValue(batchAvailable),
          frozen_micros: dbValue(batchFrozen),
        }, { where: { id: batch.id }, transaction: tx });
        await PointHoldItem.create({
          id: crypto.randomUUID(),
          hold_id: hold.id,
          batch_id: batch.id,
          allocated_micros: dbValue(allocated),
        }, { transaction: tx });
        await PointLedger.create(ledgerSnapshot({
          entryKey: `freeze:${input.businessType}:${input.businessId}:${batch.id}:${sequence}`,
          userId: input.userId,
          batch: updatedBatch,
          holdId: hold.id,
          entryType: 'freeze',
          businessType: input.businessType,
          businessId: input.businessId,
          amount: allocated,
          availableDelta: -allocated,
          frozenDelta: allocated,
          accountAvailable,
          accountFrozen,
        }), { transaction: tx });
        remaining -= allocated;
      }
      if (remaining > 0n) {
        throw new BusinessError(409, ErrorCodes.INSUFFICIENT_POINTS, '可用积分批次不足');
      }

      await PointAccount.update({
        available_micros: dbValue(accountAvailable),
        frozen_micros: dbValue(accountFrozen),
        version: dbValue(value(account.version) + 1n),
      }, { where: { user_id: input.userId }, transaction: tx });

      return hold;
    });
  }

  static async settle(holdId, settleMicros, transaction = null) {
    return inTransaction(transaction, async (tx) => {
      const hold = plain(await PointHold.findOne({
        where: { id: holdId }, transaction: tx, lock: tx.LOCK.UPDATE,
      }));
      if (!hold || hold.status !== 'active') return hold;

      const total = value(hold.total_micros);
      const settleTotal = value(settleMicros) > total ? total : value(settleMicros);
      const releaseTotal = total - settleTotal;
      const account = plain(await PointAccount.findOne({
        where: { user_id: hold.user_id }, transaction: tx, lock: tx.LOCK.UPDATE,
      }));
      const accountAvailable = value(account.available_micros) + releaseTotal;
      const accountFrozen = value(account.frozen_micros) - total;
      const items = (await PointHoldItem.findAll({
        where: { hold_id: holdId }, order: [['created_at', 'ASC']], transaction: tx, lock: tx.LOCK.UPDATE,
      })).map(plain);
      let settleRemaining = settleTotal;
      let sequence = 0;

      for (const item of items) {
        const batch = plain(await PointBatch.findOne({
          where: { id: item.batch_id }, transaction: tx, lock: tx.LOCK.UPDATE,
        }));
        const allocated = value(item.allocated_micros);
        const settled = settleRemaining < allocated ? settleRemaining : allocated;
        const released = allocated - settled;
        const updated = {
          ...batch,
          available_micros: value(batch.available_micros) + released,
          frozen_micros: value(batch.frozen_micros) - allocated,
          consumed_micros: value(batch.consumed_micros) + settled,
        };
        const exhausted = value(updated.available_micros) === 0n
          && value(updated.frozen_micros) === 0n;

        await PointBatch.update({
          available_micros: dbValue(updated.available_micros),
          frozen_micros: dbValue(updated.frozen_micros),
          consumed_micros: dbValue(updated.consumed_micros),
          status: exhausted ? 'exhausted' : 'active',
        }, { where: { id: batch.id }, transaction: tx });
        await PointHoldItem.update({
          settled_micros: dbValue(settled), released_micros: dbValue(released),
        }, { where: { id: item.id }, transaction: tx });
        sequence += 1;
        if (settled > 0n) {
          await PointLedger.create(ledgerSnapshot({
            entryKey: `consume:${hold.business_type}:${hold.business_id}:${batch.id}:${sequence}`,
            userId: hold.user_id,
            batch: updated,
            holdId,
            entryType: 'consume',
            businessType: hold.business_type,
            businessId: hold.business_id,
            amount: settled,
            availableDelta: 0n,
            frozenDelta: -settled,
            consumedDelta: settled,
            accountAvailable,
            accountFrozen,
          }), { transaction: tx });
        }
        if (released > 0n) {
          await PointLedger.create(ledgerSnapshot({
            entryKey: `release:${hold.business_type}:${hold.business_id}:${batch.id}:${sequence}`,
            userId: hold.user_id,
            batch: updated,
            holdId,
            entryType: 'release',
            businessType: hold.business_type,
            businessId: hold.business_id,
            amount: released,
            availableDelta: released,
            frozenDelta: -released,
            accountAvailable,
            accountFrozen,
          }), { transaction: tx });
        }
        settleRemaining -= settled;
      }

      await PointAccount.update({
        available_micros: dbValue(accountAvailable),
        frozen_micros: dbValue(accountFrozen),
        version: dbValue(value(account.version) + 1n),
      }, { where: { user_id: hold.user_id }, transaction: tx });
      await PointHold.update({
        settled_micros: dbValue(settleTotal),
        released_micros: dbValue(releaseTotal),
        status: settleTotal > 0n ? 'settled' : 'released',
        settled_at: settleTotal > 0n ? new Date() : null,
        released_at: releaseTotal > 0n ? new Date() : null,
      }, { where: { id: holdId }, transaction: tx });

      return { settledMicros: dbValue(settleTotal), releasedMicros: dbValue(releaseTotal) };
    });
  }

  static release(holdId, transaction = null) {
    return PointWallet.settle(holdId, 0, transaction);
  }

  static async balance(userId) {
    const account = plain(await PointAccount.findOne({ where: { user_id: userId } }));

    return {
      availableMicros: String(account ? account.available_micros : 0),
      frozenMicros: String(account ? account.frozen_micros : 0),
    };
  }
}

module.exports = PointWallet;
