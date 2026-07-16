function timestamps(DataTypes, sequelize) {
  return {
    created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    updated_at: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: sequelize.literal('CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP'),
    },
  };
}

async function addIndexes(queryInterface, table, indexes, transaction) {
  for (const index of indexes) {
    await queryInterface.addIndex(table, index.fields, {
      name: index.name, unique: Boolean(index.unique), transaction,
    });
  }
}

module.exports = {
  async up(queryInterface, DataTypes, { transaction, sequelize }) {
    const ts = timestamps(DataTypes, sequelize);

    await queryInterface.createTable('mm_ai_requests', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_users', key: 'id' }, onDelete: 'RESTRICT',
      },
      client_request_id: { type: DataTypes.CHAR(36), allowNull: false },
      request_type: { type: DataTypes.STRING(16), allowNull: false },
      task_type: { type: DataTypes.STRING(32), allowNull: false },
      asset_type: { type: DataTypes.STRING(32), allowNull: true },
      prompt_profile_version: { type: DataTypes.STRING(64), allowNull: true },
      style_code: { type: DataTypes.STRING(32), allowNull: true },
      layout_code: { type: DataTypes.STRING(32), allowNull: true },
      palette_code: { type: DataTypes.STRING(32), allowNull: true },
      preset_code: { type: DataTypes.STRING(64), allowNull: true },
      reference_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      resolution: { type: DataTypes.STRING(8), allowNull: true },
      aspect_ratio: { type: DataTypes.STRING(16), allowNull: true },
      requested_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      success_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      failed_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING(32), allowNull: false },
      hold_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_point_holds', key: 'id' }, onDelete: 'RESTRICT',
      },
      charged_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      provider: { type: DataTypes.STRING(32), allowNull: true },
      provider_model: { type: DataTypes.STRING(64), allowNull: true },
      provider_cost_micros_usd: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      input_length: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      output_length: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      latency_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      error_code: { type: DataTypes.STRING(64), allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_ai_requests', [
      { name: 'uk_mm_ai_requests_user_request', fields: ['user_id', 'client_request_id'], unique: true },
      { name: 'uk_mm_ai_requests_hold', fields: ['hold_id'], unique: true },
      { name: 'idx_mm_ai_requests_user_created', fields: ['user_id', 'created_at', 'id'] },
      { name: 'idx_mm_ai_requests_worker', fields: ['status', 'created_at'] },
      { name: 'idx_mm_ai_requests_heartbeat', fields: ['status', 'heartbeat_at'] },
    ], transaction);

    await queryInterface.createTable('mm_ai_provider_calls', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      request_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_ai_requests', key: 'id' }, onDelete: 'RESTRICT',
      },
      sequence_no: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      attempt_no: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      provider: { type: DataTypes.STRING(32), allowNull: false },
      operation: { type: DataTypes.STRING(16), allowNull: false },
      provider_model: { type: DataTypes.STRING(64), allowNull: false },
      provider_request_id: { type: DataTypes.STRING(128), allowNull: true },
      prompt_version: { type: DataTypes.STRING(64), allowNull: false },
      pricing_version: { type: DataTypes.STRING(64), allowNull: false },
      status: { type: DataTypes.STRING(16), allowNull: false },
      input_tokens: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      cached_input_tokens: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      output_tokens: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      total_tokens: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      provider_cost_micros_usd: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      latency_ms: { type: DataTypes.INTEGER.UNSIGNED, allowNull: true },
      error_code: { type: DataTypes.STRING(64), allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: false },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_ai_provider_calls', [
      { name: 'uk_mm_ai_provider_calls_attempt', fields: ['request_id', 'sequence_no', 'attempt_no'], unique: true },
      { name: 'uk_mm_ai_provider_calls_provider_request', fields: ['provider', 'provider_request_id'], unique: true },
      { name: 'idx_mm_ai_provider_calls_request_status', fields: ['request_id', 'status'] },
    ], transaction);

    await queryInterface.createTable('mm_ai_request_payloads', {
      request_id: {
        type: DataTypes.CHAR(36), primaryKey: true,
        references: { model: 'mm_ai_requests', key: 'id' }, onDelete: 'CASCADE',
      },
      payload_json: { type: DataTypes.JSON, allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    }, { transaction });
    await queryInterface.addIndex('mm_ai_request_payloads', ['expires_at'], {
      name: 'idx_mm_ai_payloads_expires', transaction,
    });

    await queryInterface.createTable('mm_ai_reference_inputs', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_users', key: 'id' }, onDelete: 'RESTRICT',
      },
      request_id: { type: DataTypes.CHAR(36), allowNull: true },
      status: { type: DataTypes.STRING(32), allowNull: false },
      relative_path: { type: DataTypes.STRING(512), allowNull: true },
      mime_type: { type: DataTypes.STRING(64), allowNull: false },
      width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      byte_size: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      sha256: { type: DataTypes.CHAR(64), allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      bound_at: { type: DataTypes.DATE, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_ai_reference_inputs', [
      { name: 'idx_mm_ai_reference_inputs_user', fields: ['user_id', 'status', 'created_at'] },
      { name: 'idx_mm_ai_reference_inputs_request', fields: ['request_id', 'status'] },
      { name: 'idx_mm_ai_reference_inputs_cleanup', fields: ['status', 'expires_at'] },
    ], transaction);

    await queryInterface.createTable('mm_ai_outputs', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      request_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_ai_requests', key: 'id' }, onDelete: 'RESTRICT',
      },
      sequence_no: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      relative_path: { type: DataTypes.STRING(512), allowNull: false },
      mime_type: { type: DataTypes.STRING(64), allowNull: false },
      width: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      height: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      byte_size: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      sha256: { type: DataTypes.CHAR(64), allowNull: false },
      provider_cost_micros_usd: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      downloaded_at: { type: DataTypes.DATE, allowNull: true },
      deleted_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_ai_outputs', [
      { name: 'uk_mm_ai_outputs_request_sequence', fields: ['request_id', 'sequence_no'], unique: true },
      { name: 'idx_mm_ai_outputs_cleanup', fields: ['status', 'expires_at'] },
      { name: 'idx_mm_ai_outputs_request_status', fields: ['request_id', 'status'] },
    ], transaction);
  },
};
