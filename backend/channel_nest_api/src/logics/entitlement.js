const { Op } = require('sequelize');
const {
  MembershipPeriod,
  MembershipPlan,
  PlanEntitlement,
} = require('../models/domain');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');

const CapabilityCodes = [
  'core.channel_accounts',
  'core.dashboard',
  'core.works',
  'core.publish',
  'billing.view',
  'billing.purchase',
  'messages.view',
  'ai.text',
  'ai.image.1k',
  'ai.image.2k',
  'ai.image.4k',
  'premium.comments',
  'premium.third_party_data',
];

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

class EntitlementLogic {
  static async snapshot(userId) {
    const now = new Date();
    const period = plain(await MembershipPeriod.findOne({
      where: {
        user_id: userId,
        status: 'active',
        starts_at: { [Op.lte]: now },
        ends_at: { [Op.gt]: now },
      },
      order: [['starts_at', 'DESC']],
    }));
    const plan = plain(await MembershipPlan.findOne({
      where: period
        ? { id: period.plan_id }
        : { code: 'free', status: 'active' },
    }));
    const rows = plan
      ? (await PlanEntitlement.findAll({ where: { plan_id: plan.id } })).map(plain)
      : [];
    const capabilities = {};
    CapabilityCodes.forEach((code) => {
      const row = rows.find((item) => item.capability_code === code);
      capabilities[code] = {
        allowed: Boolean(row && row.allowed),
        reason: row && row.allowed ? null : 'upgrade_required',
        limits: row ? row.limits_json : {},
      };
    });

    let maxImageResolution = null;
    if (capabilities['ai.image.4k'].allowed) maxImageResolution = '4k';
    else if (capabilities['ai.image.2k'].allowed) maxImageResolution = '2k';
    else if (capabilities['ai.image.1k'].allowed) maxImageResolution = '1k';

    return {
      plan: plan ? {
        id: plan.id,
        code: plan.code,
        name: plan.name_zh,
        version: plan.version,
        rechargeDiscountBps: plan.recharge_discount_bps,
      } : null,
      membership: {
        status: period ? period.status : 'free',
        startsAt: period ? period.starts_at : null,
        endsAt: period ? period.ends_at : null,
      },
      premiumFeatures: Boolean(plan && plan.code !== 'free'),
      maxImageResolution,
      capabilities,
      snapshotExpiresAt: new Date(Date.now() + 60 * 1000),
    };
  }

  static async check(userId, capabilityCode) {
    if (!CapabilityCodes.includes(capabilityCode)) {
      throw new BusinessError(403, ErrorCodes.UPGRADE_REQUIRED, '未知或不可用的权限');
    }
    const snapshot = await EntitlementLogic.snapshot(userId);
    const result = snapshot.capabilities[capabilityCode];

    return { capabilityCode, ...result, planCode: snapshot.plan && snapshot.plan.code };
  }

  static async require(userId, capabilityCode) {
    const result = await EntitlementLogic.check(userId, capabilityCode);
    if (!result.allowed) {
      throw new BusinessError(403, ErrorCodes.UPGRADE_REQUIRED, '当前会员等级不支持此功能');
    }

    return result;
  }
}

EntitlementLogic.CapabilityCodes = CapabilityCodes;

module.exports = EntitlementLogic;
