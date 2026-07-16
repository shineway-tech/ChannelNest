/* eslint-disable no-await-in-loop */
const fs = require('fs');
const path = require('path');
const { Op } = require('sequelize');
const sequelize = require('../libs/sequelizor');
const AuthCaptcha = require('../models/auth_captcha');
const EmailVerificationCode = require('../models/email_verification_code');
const {
  AiOutput,
  AiReferenceInput,
  AiRequest,
  AiRequestPayload,
  MembershipPeriod,
  MembershipPlan,
  UserMessage,
} = require('../models/domain');
const PointWallet = require('../logics/point_wallet');
const config = require('../../config');

async function removeRelative(relativePath) {
  if (!relativePath) return;
  const root = path.resolve(config.ai_temp_storage.path);
  const target = path.resolve(root, relativePath);
  if (target.startsWith(`${root}${path.sep}`)) await fs.promises.rm(target, { force: true });
}

class MaintenanceWorker {
  static async run() {
    const now = new Date();
    const emailRetentionDays = config.email.verification.retention_days;
    const emailRetentionCutoff = new Date(now.getTime() - emailRetentionDays * 24 * 60 * 60 * 1000);
    await AuthCaptcha.destroy({ where: { expires_at: { [Op.lte]: now } } });
    await EmailVerificationCode.destroy({
      where: { created_at: { [Op.lte]: emailRetentionCutoff } },
    });
    await UserMessage.destroy({ where: { expires_at: { [Op.lte]: now } } });
    const outputs = await AiOutput.findAll({
      where: { status: 'ready', expires_at: { [Op.lte]: now } }, limit: 100,
    });
    for (const output of outputs) {
      await removeRelative(output.relative_path);
      await output.update({ status: 'expired', relative_path: '', deleted_at: now });
    }
    const references = await AiReferenceInput.findAll({
      where: { status: 'uploaded', expires_at: { [Op.lte]: now } }, limit: 100,
    });
    for (const reference of references) {
      await removeRelative(reference.relative_path);
      await reference.update({ status: 'expired', relative_path: null, deleted_at: now });
    }
    const payloads = await AiRequestPayload.findAll({
      where: { expires_at: { [Op.lte]: now } }, limit: 100,
    });
    for (const payload of payloads) {
      await sequelize.transaction(async (transaction) => {
        const request = await AiRequest.findOne({
          where: { id: payload.request_id, status: 'pending' },
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (request) {
          await PointWallet.release(request.hold_id, transaction);
          await request.update({
            status: 'failed',
            failed_count: request.requested_count,
            error_code: 'payload_expired',
            completed_at: now,
          }, { transaction });
        }
        await payload.destroy({ transaction });
      });
    }

    await MaintenanceWorker.advanceMemberships(now);
  }

  static async advanceMemberships(now) {
    const expired = await MembershipPeriod.findAll({
      where: { status: 'active', ends_at: { [Op.lte]: now } }, limit: 100,
    });
    for (const period of expired) {
      await sequelize.transaction(async (transaction) => {
        await MembershipPeriod.update({
          status: 'expired', active_user_guard: null, expired_at: now,
        }, { where: { id: period.id, status: 'active' }, transaction });
        const pending = await MembershipPeriod.findOne({
          where: { user_id: period.user_id, status: 'pending', starts_at: { [Op.lte]: now } },
          order: [['starts_at', 'ASC']],
          transaction,
          lock: transaction.LOCK.UPDATE,
        });
        if (pending) {
          const plan = await MembershipPlan.findOne({
            where: { id: pending.plan_id }, transaction,
          });
          const batch = await PointWallet.grant({
            userId: pending.user_id,
            sourceType: 'membership_gift',
            sourceId: pending.id,
            amountMicros: plan.grant_micros,
            expiresAt: pending.ends_at,
            spendPriority: 10,
          }, transaction);
          await pending.update({
            status: 'active',
            active_user_guard: pending.user_id,
            activated_at: now,
            grant_batch_id: batch.id,
          }, { transaction });
        }
      });
    }
  }
}

module.exports = MaintenanceWorker;
