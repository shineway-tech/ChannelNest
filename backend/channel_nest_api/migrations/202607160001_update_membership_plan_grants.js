const PlanGrantMicros = {
  basic: 2000000,
  advanced: 4200000,
  professional: 6500000,
};

module.exports = {
  async up(queryInterface, _DataTypes, { transaction }) {
    const now = new Date();

    for (const [code, grantMicros] of Object.entries(PlanGrantMicros)) {
      await queryInterface.bulkUpdate(
        'mm_membership_plans',
        {
          grant_micros: grantMicros,
          updated_at: now,
        },
        {
          code,
          version: 1,
          status: 'active',
        },
        { transaction },
      );
    }
  },
};
