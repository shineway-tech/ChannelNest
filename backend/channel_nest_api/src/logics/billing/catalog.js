const { Op } = require('sequelize');

const RechargePackages = {
  points_1000: {
    pointsMicros: 1000000, amountFen: 1000, name: '1,000 积分', nameEn: '1,000 Points',
  },
  points_5000: {
    pointsMicros: 5000000, amountFen: 5000, name: '5,000 积分', nameEn: '5,000 Points',
  },
  points_10000: {
    pointsMicros: 10000000, amountFen: 10000, name: '10,000 积分', nameEn: '10,000 Points',
  },
  points_30000: {
    pointsMicros: 30000000, amountFen: 30000, name: '30,000 积分', nameEn: '30,000 Points',
  },
};

const PlanRank = {
  free: 0, basic: 1, advanced: 2, professional: 3,
};

const LedgerSourceFilters = {
  signup: 'signup_gift',
  membership: { [Op.in]: ['membership_gift', 'membership_upgrade_gift'] },
  recharge: 'recharge',
  ai_text: { [Op.in]: ['ai_text', 'ai_prompt_optimize'] },
  ai_image: { [Op.like]: 'ai_image_%' },
};

const LedgerRangeDays = new Set([7, 30, 90, 365]);

const OrderTypeFilters = {
  membership: { [Op.in]: ['membership', 'renewal', 'upgrade'] },
  recharge: 'recharge',
};

const OrderStatusFilters = {
  paid: 'paid',
  closed: 'closed',
  failed: 'failed',
};

const OrderRangeDays = new Set([7, 30, 90, 365]);

function membershipPlanSummary(plan) {
  return {
    code: plan.code,
    name: plan.name_zh,
    nameEn: plan.name_en,
    rank: PlanRank[plan.code] || 0,
    cycleDays: plan.cycle_days,
    priceFen: plan.price_fen,
    grantMicros: String(plan.grant_micros),
    rechargeDiscountBps: plan.recharge_discount_bps,
  };
}

function rechargePackageSummary(code, item, discountBps) {
  return {
    productCode: code,
    name: item.name,
    nameEn: item.nameEn,
    pointsMicros: String(item.pointsMicros),
    listAmountFen: item.amountFen,
    payAmountFen: Math.ceil((item.amountFen * discountBps) / 10000),
  };
}

function rechargePackageSummaries(discountBps) {
  return Object.entries(RechargePackages).map(([code, item]) => (
    rechargePackageSummary(code, item, discountBps)
  ));
}

module.exports = {
  LedgerRangeDays,
  LedgerSourceFilters,
  OrderRangeDays,
  OrderStatusFilters,
  OrderTypeFilters,
  PlanRank,
  RechargePackages,
  membershipPlanSummary,
  rechargePackageSummaries,
};
