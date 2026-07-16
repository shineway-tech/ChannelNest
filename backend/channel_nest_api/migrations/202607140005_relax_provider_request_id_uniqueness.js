const Table = 'mm_ai_provider_calls';
const UniqueIndex = 'uk_mm_ai_provider_calls_provider_request';
const LookupIndex = 'idx_mm_ai_provider_calls_provider_request';
const Fields = ['provider', 'provider_request_id'];

module.exports = {
  async up(queryInterface, DataTypes, { transaction }) {
    await queryInterface.removeIndex(Table, UniqueIndex, { transaction });
    await queryInterface.addIndex(Table, Fields, {
      name: LookupIndex,
      transaction,
    });
  },

  async down(queryInterface, DataTypes, { transaction }) {
    await queryInterface.removeIndex(Table, LookupIndex, { transaction });
    await queryInterface.addIndex(Table, Fields, {
      name: UniqueIndex,
      unique: true,
      transaction,
    });
  },
};
