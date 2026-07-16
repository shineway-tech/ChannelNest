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
      name: index.name,
      unique: Boolean(index.unique),
      transaction,
    });
  }
}

module.exports = {
  async up(queryInterface, DataTypes, { transaction, sequelize }) {
    const ts = timestamps(DataTypes, sequelize);
    const userRef = {
      type: DataTypes.CHAR(36), allowNull: false,
      references: { model: 'mm_users', key: 'id' }, onDelete: 'RESTRICT',
    };

    await queryInterface.createTable('mm_membership_plans', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      code: { type: DataTypes.STRING(32), allowNull: false },
      version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      name_zh: { type: DataTypes.STRING(64), allowNull: false },
      name_en: { type: DataTypes.STRING(64), allowNull: false },
      cycle_days: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      price_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      grant_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      recharge_discount_bps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      effective_from: { type: DataTypes.DATE, allowNull: false },
      retired_at: { type: DataTypes.DATE, allowNull: true },
      active_code_guard: { type: DataTypes.STRING(32), allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_membership_plans', [
      { name: 'uk_mm_membership_plans_code_version', fields: ['code', 'version'], unique: true },
      { name: 'uk_mm_membership_plans_one_active', fields: ['active_code_guard'], unique: true },
      { name: 'idx_mm_membership_plans_status_effective', fields: ['status', 'effective_from'] },
    ], transaction);

    await queryInterface.createTable('mm_plan_entitlements', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      plan_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_membership_plans', key: 'id' }, onDelete: 'RESTRICT',
      },
      capability_code: { type: DataTypes.STRING(64), allowNull: false },
      allowed: { type: DataTypes.BOOLEAN, allowNull: false },
      limits_json: { type: DataTypes.JSON, allowNull: false },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_plan_entitlements', [
      { name: 'uk_mm_plan_entitlements_plan_cap', fields: ['plan_id', 'capability_code'], unique: true },
      { name: 'idx_mm_plan_entitlements_cap', fields: ['capability_code', 'allowed'] },
    ], transaction);

    await queryInterface.createTable('mm_billing_orders', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      order_no: { type: DataTypes.STRING(32), allowNull: false },
      user_id: userRef,
      order_type: { type: DataTypes.STRING(32), allowNull: false },
      product_code: { type: DataTypes.STRING(64), allowNull: false },
      product_snapshot: { type: DataTypes.JSON, allowNull: false },
      currency: { type: DataTypes.CHAR(3), allowNull: false, defaultValue: 'CNY' },
      list_amount_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      discount_bps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      pay_amount_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      client_request_id: { type: DataTypes.CHAR(36), allowNull: false },
      payment_provider: { type: DataTypes.STRING(32), allowNull: true },
      active_payment_attempt_id: { type: DataTypes.CHAR(36), allowNull: true },
      failure_code: { type: DataTypes.STRING(64), allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_billing_orders', [
      { name: 'uk_mm_billing_orders_order_no', fields: ['order_no'], unique: true },
      { name: 'uk_mm_billing_orders_user_request', fields: ['user_id', 'client_request_id'], unique: true },
      { name: 'idx_mm_billing_orders_user_created', fields: ['user_id', 'created_at', 'id'] },
      { name: 'idx_mm_billing_orders_status_expires', fields: ['status', 'expires_at'] },
    ], transaction);

    await queryInterface.createTable('mm_payment_attempts', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      order_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_billing_orders', key: 'id' }, onDelete: 'RESTRICT',
      },
      client_request_id: { type: DataTypes.CHAR(36), allowNull: false },
      provider: { type: DataTypes.STRING(32), allowNull: false },
      provider_order_id: { type: DataTypes.STRING(128), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      checkout_type: { type: DataTypes.STRING(32), allowNull: false },
      checkout_value: { type: DataTypes.TEXT, allowNull: true },
      active_order_guard: { type: DataTypes.CHAR(36), allowNull: true },
      provider_created_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      last_queried_at: { type: DataTypes.DATE, allowNull: true },
      query_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
      paid_at: { type: DataTypes.DATE, allowNull: true },
      closed_at: { type: DataTypes.DATE, allowNull: true },
      error_code: { type: DataTypes.STRING(64), allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_payment_attempts', [
      { name: 'uk_mm_payment_attempts_order_request', fields: ['order_id', 'client_request_id'], unique: true },
      { name: 'uk_mm_payment_attempts_provider_order', fields: ['provider', 'provider_order_id'], unique: true },
      { name: 'uk_mm_payment_attempts_one_active', fields: ['active_order_guard'], unique: true },
      { name: 'idx_mm_payment_attempts_reconcile', fields: ['status', 'last_queried_at', 'expires_at'] },
    ], transaction);

    await queryInterface.createTable('mm_payment_events', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      provider: { type: DataTypes.STRING(32), allowNull: false },
      event_key: { type: DataTypes.CHAR(64), allowNull: false },
      provider_event_id: { type: DataTypes.STRING(128), allowNull: true },
      provider_order_id: { type: DataTypes.STRING(128), allowNull: false },
      order_id: { type: DataTypes.CHAR(36), allowNull: true },
      attempt_id: { type: DataTypes.CHAR(36), allowNull: true },
      event_type: { type: DataTypes.STRING(64), allowNull: false },
      trade_status: { type: DataTypes.STRING(32), allowNull: false },
      currency: { type: DataTypes.CHAR(3), allowNull: false },
      amount_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      payload_digest: { type: DataTypes.CHAR(64), allowNull: false },
      process_status: { type: DataTypes.STRING(32), allowNull: false },
      rejection_code: { type: DataTypes.STRING(64), allowNull: true },
      safe_metadata_json: { type: DataTypes.JSON, allowNull: false },
      received_at: { type: DataTypes.DATE, allowNull: false },
      processed_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_payment_events', [
      { name: 'uk_mm_payment_events_provider_key', fields: ['provider', 'event_key'], unique: true },
      { name: 'idx_mm_payment_events_provider_order', fields: ['provider', 'provider_order_id'] },
      { name: 'idx_mm_payment_events_process', fields: ['process_status', 'received_at'] },
    ], transaction);

    await queryInterface.createTable('mm_point_accounts', {
      user_id: { ...userRef, primaryKey: true },
      available_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      frozen_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      version: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      ...ts,
    }, { transaction });

    await queryInterface.createTable('mm_point_batches', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: userRef,
      source_type: { type: DataTypes.STRING(32), allowNull: false },
      source_id: { type: DataTypes.CHAR(36), allowNull: false },
      spend_priority: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
      total_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      available_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      frozen_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      consumed_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      expired_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_point_batches', [
      { name: 'uk_mm_point_batches_source', fields: ['user_id', 'source_type', 'source_id'], unique: true },
      { name: 'idx_mm_point_batches_spend', fields: ['user_id', 'status', 'spend_priority', 'expires_at', 'created_at'] },
      { name: 'idx_mm_point_batches_expire', fields: ['status', 'expires_at'] },
    ], transaction);

    await queryInterface.createTable('mm_point_holds', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: userRef,
      business_type: { type: DataTypes.STRING(32), allowNull: false },
      business_id: { type: DataTypes.CHAR(36), allowNull: false },
      total_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      settled_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      released_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      status: { type: DataTypes.STRING(32), allowNull: false },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      heartbeat_at: { type: DataTypes.DATE, allowNull: true },
      settled_at: { type: DataTypes.DATE, allowNull: true },
      released_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_point_holds', [
      { name: 'uk_mm_point_holds_business', fields: ['user_id', 'business_type', 'business_id'], unique: true },
      { name: 'idx_mm_point_holds_expire', fields: ['status', 'expires_at', 'heartbeat_at'] },
    ], transaction);

    await queryInterface.createTable('mm_point_hold_items', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      hold_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_point_holds', key: 'id' }, onDelete: 'RESTRICT',
      },
      batch_id: {
        type: DataTypes.CHAR(36), allowNull: false,
        references: { model: 'mm_point_batches', key: 'id' }, onDelete: 'RESTRICT',
      },
      allocated_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      settled_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      released_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_point_hold_items', [
      { name: 'uk_mm_point_hold_items_hold_batch', fields: ['hold_id', 'batch_id'], unique: true },
      { name: 'idx_mm_point_hold_items_batch', fields: ['batch_id'] },
    ], transaction);

    await queryInterface.createTable('mm_point_ledgers', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      entry_key: { type: DataTypes.STRING(191), allowNull: false },
      user_id: userRef,
      batch_id: { type: DataTypes.CHAR(36), allowNull: true },
      hold_id: { type: DataTypes.CHAR(36), allowNull: true },
      entry_type: { type: DataTypes.STRING(32), allowNull: false },
      business_type: { type: DataTypes.STRING(32), allowNull: false },
      business_id: { type: DataTypes.CHAR(36), allowNull: false },
      amount_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      available_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
      frozen_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
      consumed_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
      expired_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
      account_available_after: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      account_frozen_after: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false },
      batch_available_after: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      batch_frozen_after: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      batch_consumed_after: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      batch_expired_after: { type: DataTypes.BIGINT.UNSIGNED, allowNull: true },
      expires_at_snapshot: { type: DataTypes.DATE, allowNull: true },
      metadata_json: { type: DataTypes.JSON, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    }, { transaction });
    await addIndexes(queryInterface, 'mm_point_ledgers', [
      { name: 'uk_mm_point_ledgers_entry_key', fields: ['entry_key'], unique: true },
      { name: 'idx_mm_point_ledgers_user_created', fields: ['user_id', 'created_at', 'id'] },
      { name: 'idx_mm_point_ledgers_business', fields: ['business_type', 'business_id'] },
    ], transaction);

    await queryInterface.createTable('mm_membership_periods', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: userRef,
      plan_id: { type: DataTypes.CHAR(36), allowNull: false },
      source_order_id: { type: DataTypes.CHAR(36), allowNull: false },
      status: { type: DataTypes.STRING(32), allowNull: false },
      starts_at: { type: DataTypes.DATE, allowNull: false },
      ends_at: { type: DataTypes.DATE, allowNull: false },
      grant_batch_id: { type: DataTypes.CHAR(36), allowNull: true },
      active_user_guard: { type: DataTypes.CHAR(36), allowNull: true },
      activated_at: { type: DataTypes.DATE, allowNull: true },
      expired_at: { type: DataTypes.DATE, allowNull: true },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_membership_periods', [
      { name: 'uk_mm_membership_periods_source_order', fields: ['source_order_id'], unique: true },
      { name: 'uk_mm_membership_periods_grant_batch', fields: ['grant_batch_id'], unique: true },
      { name: 'uk_mm_membership_periods_one_active', fields: ['active_user_guard'], unique: true },
      { name: 'idx_mm_membership_periods_user_timeline', fields: ['user_id', 'starts_at', 'ends_at'] },
      { name: 'idx_mm_membership_periods_status_end', fields: ['status', 'ends_at'] },
    ], transaction);

    await queryInterface.createTable('mm_membership_events', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: userRef,
      period_id: { type: DataTypes.CHAR(36), allowNull: false },
      event_type: { type: DataTypes.STRING(32), allowNull: false },
      from_plan_id: { type: DataTypes.CHAR(36), allowNull: true },
      to_plan_id: { type: DataTypes.CHAR(36), allowNull: true },
      source_order_id: { type: DataTypes.CHAR(36), allowNull: true },
      delta_grant_micros: { type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 },
      effective_at: { type: DataTypes.DATE, allowNull: false },
      dedupe_key: { type: DataTypes.STRING(191), allowNull: false },
      metadata_json: { type: DataTypes.JSON, allowNull: false },
      created_at: { type: DataTypes.DATE, allowNull: false, defaultValue: sequelize.literal('CURRENT_TIMESTAMP') },
    }, { transaction });
    await addIndexes(queryInterface, 'mm_membership_events', [
      { name: 'uk_mm_membership_events_dedupe', fields: ['dedupe_key'], unique: true },
      { name: 'idx_mm_membership_events_user_created', fields: ['user_id', 'created_at', 'id'] },
    ], transaction);

    await queryInterface.createTable('mm_user_messages', {
      id: { type: DataTypes.CHAR(36), primaryKey: true },
      user_id: userRef,
      category: { type: DataTypes.STRING(32), allowNull: false },
      level: { type: DataTypes.STRING(16), allowNull: false },
      template_code: { type: DataTypes.STRING(64), allowNull: false },
      template_params: { type: DataTypes.JSON, allowNull: false },
      action_code: { type: DataTypes.STRING(32), allowNull: true },
      action_ref_id: { type: DataTypes.CHAR(36), allowNull: true },
      dedupe_key: { type: DataTypes.STRING(191), allowNull: false },
      read_at: { type: DataTypes.DATE, allowNull: true },
      expires_at: { type: DataTypes.DATE, allowNull: false },
      ...ts,
    }, { transaction });
    await addIndexes(queryInterface, 'mm_user_messages', [
      { name: 'uk_mm_user_messages_user_dedupe', fields: ['user_id', 'dedupe_key'], unique: true },
      { name: 'idx_mm_user_messages_user_unread', fields: ['user_id', 'read_at', 'created_at', 'id'] },
      { name: 'idx_mm_user_messages_cleanup', fields: ['expires_at'] },
    ], transaction);
  },
};
