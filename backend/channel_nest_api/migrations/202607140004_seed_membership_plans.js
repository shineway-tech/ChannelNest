const PlanIds = {
  free: '10000000-0000-4000-8000-000000000001',
  basic: '10000000-0000-4000-8000-000000000002',
  advanced: '10000000-0000-4000-8000-000000000003',
  professional: '10000000-0000-4000-8000-000000000004',
};

const Plans = [
  ['free', '免费版', 'Free', 0, 0, 0, 10000],
  ['basic', '普通会员', 'Basic', 30, 1900, 2000000, 9500],
  ['advanced', '高级会员', 'Advanced', 30, 3900, 4200000, 9000],
  ['professional', '专业会员', 'Professional', 30, 5900, 6500000, 8500],
];

const Matrix = {
  'core.channel_accounts': [1, 1, 1, 1],
  'core.dashboard': [1, 1, 1, 1],
  'core.works': [1, 1, 1, 1],
  'core.publish': [1, 1, 1, 1],
  'billing.view': [1, 1, 1, 1],
  'billing.purchase': [1, 1, 1, 1],
  'messages.view': [1, 1, 1, 1],
  'ai.text': [1, 1, 1, 1],
  'ai.image.1k': [1, 1, 1, 1],
  'ai.image.2k': [0, 0, 1, 1],
  'ai.image.4k': [0, 0, 0, 1],
  'premium.comments': [0, 1, 1, 1],
  'premium.third_party_data': [0, 1, 1, 1],
};

module.exports = {
  async up(queryInterface, DataTypes, { transaction }) {
    const now = new Date();
    await queryInterface.bulkInsert('mm_membership_plans', Plans.map(plan => ({
      id: PlanIds[plan[0]],
      code: plan[0],
      version: 1,
      name_zh: plan[1],
      name_en: plan[2],
      cycle_days: plan[3],
      price_fen: plan[4],
      grant_micros: plan[5],
      recharge_discount_bps: plan[6],
      status: 'active',
      effective_from: now,
      active_code_guard: plan[0],
      created_at: now,
      updated_at: now,
    })), { transaction });

    const rows = [];
    Plans.forEach((plan, planIndex) => {
      Object.entries(Matrix).forEach(([capability, values], capabilityIndex) => {
        rows.push({
          id: `20000000-0000-4000-${String(8000 + planIndex)}-${String(capabilityIndex + 1).padStart(12, '0')}`,
          plan_id: PlanIds[plan[0]],
          capability_code: capability,
          allowed: values[planIndex],
          limits_json: JSON.stringify({}),
          created_at: now,
          updated_at: now,
        });
      });
    });
    await queryInterface.bulkInsert('mm_plan_entitlements', rows, { transaction });
  },
};
