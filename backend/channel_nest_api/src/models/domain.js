const { DataTypes } = require('sequelize');
const sequelize = require('../libs/sequelizor');

function define(name, tableName, attributes, options = {}) {
  return sequelize.define(name, attributes, {
    tableName,
    underscored: true,
    ...options,
  });
}

const id = () => ({ type: DataTypes.CHAR(36), primaryKey: true });
const requiredId = () => ({ type: DataTypes.CHAR(36), allowNull: false });
const micros = () => ({ type: DataTypes.BIGINT.UNSIGNED, allowNull: false, defaultValue: 0 });

const MembershipPlan = define('MembershipPlan', 'mm_membership_plans', {
  id: id(),
  code: { type: DataTypes.STRING(32), allowNull: false },
  version: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  name_zh: { type: DataTypes.STRING(64), allowNull: false },
  name_en: { type: DataTypes.STRING(64), allowNull: false },
  cycle_days: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  price_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  grant_micros: micros(),
  recharge_discount_bps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false },
  effective_from: { type: DataTypes.DATE, allowNull: false },
  retired_at: DataTypes.DATE,
  active_code_guard: DataTypes.STRING(32),
});

const PlanEntitlement = define('PlanEntitlement', 'mm_plan_entitlements', {
  id: id(),
  plan_id: requiredId(),
  capability_code: { type: DataTypes.STRING(64), allowNull: false },
  allowed: { type: DataTypes.BOOLEAN, allowNull: false },
  limits_json: { type: DataTypes.JSON, allowNull: false },
});

const BillingOrder = define('BillingOrder', 'mm_billing_orders', {
  id: id(),
  order_no: { type: DataTypes.STRING(32), allowNull: false },
  user_id: requiredId(),
  order_type: { type: DataTypes.STRING(32), allowNull: false },
  product_code: { type: DataTypes.STRING(64), allowNull: false },
  product_snapshot: { type: DataTypes.JSON, allowNull: false },
  currency: { type: DataTypes.CHAR(3), allowNull: false },
  list_amount_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  discount_bps: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  pay_amount_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false },
  client_request_id: requiredId(),
  payment_provider: DataTypes.STRING(32),
  active_payment_attempt_id: DataTypes.CHAR(36),
  failure_code: DataTypes.STRING(64),
  expires_at: { type: DataTypes.DATE, allowNull: false },
  paid_at: DataTypes.DATE,
  closed_at: DataTypes.DATE,
});

const PaymentAttempt = define('PaymentAttempt', 'mm_payment_attempts', {
  id: id(),
  order_id: requiredId(),
  client_request_id: requiredId(),
  provider: { type: DataTypes.STRING(32), allowNull: false },
  provider_order_id: { type: DataTypes.STRING(128), allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false },
  checkout_type: { type: DataTypes.STRING(32), allowNull: false },
  checkout_value: DataTypes.TEXT,
  active_order_guard: DataTypes.CHAR(36),
  provider_created_at: DataTypes.DATE,
  expires_at: { type: DataTypes.DATE, allowNull: false },
  last_queried_at: DataTypes.DATE,
  query_count: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false, defaultValue: 0 },
  paid_at: DataTypes.DATE,
  closed_at: DataTypes.DATE,
  error_code: DataTypes.STRING(64),
});

const PaymentEvent = define('PaymentEvent', 'mm_payment_events', {
  id: id(),
  provider: { type: DataTypes.STRING(32), allowNull: false },
  event_key: { type: DataTypes.CHAR(64), allowNull: false },
  provider_event_id: DataTypes.STRING(128),
  provider_order_id: { type: DataTypes.STRING(128), allowNull: false },
  order_id: DataTypes.CHAR(36),
  attempt_id: DataTypes.CHAR(36),
  event_type: { type: DataTypes.STRING(64), allowNull: false },
  trade_status: { type: DataTypes.STRING(32), allowNull: false },
  currency: { type: DataTypes.CHAR(3), allowNull: false },
  amount_fen: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  payload_digest: { type: DataTypes.CHAR(64), allowNull: false },
  process_status: { type: DataTypes.STRING(32), allowNull: false },
  rejection_code: DataTypes.STRING(64),
  safe_metadata_json: { type: DataTypes.JSON, allowNull: false },
  received_at: { type: DataTypes.DATE, allowNull: false },
  processed_at: DataTypes.DATE,
});

const PointAccount = define('PointAccount', 'mm_point_accounts', {
  user_id: { ...requiredId(), primaryKey: true },
  available_micros: micros(),
  frozen_micros: micros(),
  version: micros(),
});

const PointBatch = define('PointBatch', 'mm_point_batches', {
  id: id(),
  user_id: requiredId(),
  source_type: { type: DataTypes.STRING(32), allowNull: false },
  source_id: requiredId(),
  spend_priority: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  total_micros: micros(),
  available_micros: micros(),
  frozen_micros: micros(),
  consumed_micros: micros(),
  expired_micros: micros(),
  expires_at: { type: DataTypes.DATE, allowNull: false },
  status: { type: DataTypes.STRING(32), allowNull: false },
});

const PointHold = define('PointHold', 'mm_point_holds', {
  id: id(),
  user_id: requiredId(),
  business_type: { type: DataTypes.STRING(32), allowNull: false },
  business_id: requiredId(),
  total_micros: micros(),
  settled_micros: micros(),
  released_micros: micros(),
  status: { type: DataTypes.STRING(32), allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
  heartbeat_at: DataTypes.DATE,
  settled_at: DataTypes.DATE,
  released_at: DataTypes.DATE,
});

const PointHoldItem = define('PointHoldItem', 'mm_point_hold_items', {
  id: id(),
  hold_id: requiredId(),
  batch_id: requiredId(),
  allocated_micros: micros(),
  settled_micros: micros(),
  released_micros: micros(),
});

const PointLedger = define('PointLedger', 'mm_point_ledgers', {
  id: id(),
  entry_key: { type: DataTypes.STRING(191), allowNull: false },
  user_id: requiredId(),
  batch_id: DataTypes.CHAR(36),
  hold_id: DataTypes.CHAR(36),
  entry_type: { type: DataTypes.STRING(32), allowNull: false },
  business_type: { type: DataTypes.STRING(32), allowNull: false },
  business_id: requiredId(),
  amount_micros: micros(),
  available_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
  frozen_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
  consumed_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
  expired_delta_micros: { type: DataTypes.BIGINT, allowNull: false },
  account_available_after: micros(),
  account_frozen_after: micros(),
  batch_available_after: DataTypes.BIGINT.UNSIGNED,
  batch_frozen_after: DataTypes.BIGINT.UNSIGNED,
  batch_consumed_after: DataTypes.BIGINT.UNSIGNED,
  batch_expired_after: DataTypes.BIGINT.UNSIGNED,
  expires_at_snapshot: DataTypes.DATE,
  metadata_json: { type: DataTypes.JSON, allowNull: false },
}, { updatedAt: false });

const MembershipPeriod = define('MembershipPeriod', 'mm_membership_periods', {
  id: id(),
  user_id: requiredId(),
  plan_id: requiredId(),
  source_order_id: requiredId(),
  status: { type: DataTypes.STRING(32), allowNull: false },
  starts_at: { type: DataTypes.DATE, allowNull: false },
  ends_at: { type: DataTypes.DATE, allowNull: false },
  grant_batch_id: DataTypes.CHAR(36),
  active_user_guard: DataTypes.CHAR(36),
  activated_at: DataTypes.DATE,
  expired_at: DataTypes.DATE,
});

const MembershipEvent = define('MembershipEvent', 'mm_membership_events', {
  id: id(),
  user_id: requiredId(),
  period_id: requiredId(),
  event_type: { type: DataTypes.STRING(32), allowNull: false },
  from_plan_id: DataTypes.CHAR(36),
  to_plan_id: DataTypes.CHAR(36),
  source_order_id: DataTypes.CHAR(36),
  delta_grant_micros: micros(),
  effective_at: { type: DataTypes.DATE, allowNull: false },
  dedupe_key: { type: DataTypes.STRING(191), allowNull: false },
  metadata_json: { type: DataTypes.JSON, allowNull: false },
}, { updatedAt: false });

const UserMessage = define('UserMessage', 'mm_user_messages', {
  id: id(),
  user_id: requiredId(),
  category: { type: DataTypes.STRING(32), allowNull: false },
  level: { type: DataTypes.STRING(16), allowNull: false },
  template_code: { type: DataTypes.STRING(64), allowNull: false },
  template_params: { type: DataTypes.JSON, allowNull: false },
  action_code: DataTypes.STRING(32),
  action_ref_id: DataTypes.CHAR(36),
  dedupe_key: { type: DataTypes.STRING(191), allowNull: false },
  read_at: DataTypes.DATE,
  expires_at: { type: DataTypes.DATE, allowNull: false },
});

const AiRequest = define('AiRequest', 'mm_ai_requests', {
  id: id(),
  user_id: requiredId(),
  client_request_id: requiredId(),
  request_type: DataTypes.STRING(16),
  task_type: DataTypes.STRING(32),
  asset_type: DataTypes.STRING(32),
  prompt_profile_version: DataTypes.STRING(64),
  style_code: DataTypes.STRING(32),
  layout_code: DataTypes.STRING(32),
  palette_code: DataTypes.STRING(32),
  preset_code: DataTypes.STRING(64),
  reference_count: DataTypes.INTEGER.UNSIGNED,
  resolution: DataTypes.STRING(8),
  aspect_ratio: DataTypes.STRING(16),
  requested_count: DataTypes.INTEGER.UNSIGNED,
  success_count: DataTypes.INTEGER.UNSIGNED,
  failed_count: DataTypes.INTEGER.UNSIGNED,
  status: DataTypes.STRING(32),
  hold_id: requiredId(),
  charged_micros: micros(),
  provider: DataTypes.STRING(32),
  provider_model: DataTypes.STRING(64),
  provider_cost_micros_usd: micros(),
  input_length: DataTypes.INTEGER.UNSIGNED,
  output_length: DataTypes.INTEGER.UNSIGNED,
  latency_ms: DataTypes.INTEGER.UNSIGNED,
  error_code: DataTypes.STRING(64),
  started_at: DataTypes.DATE,
  heartbeat_at: DataTypes.DATE,
  completed_at: DataTypes.DATE,
});

const AiProviderCall = define('AiProviderCall', 'mm_ai_provider_calls', {
  id: id(),
  request_id: requiredId(),
  sequence_no: DataTypes.INTEGER.UNSIGNED,
  attempt_no: DataTypes.INTEGER.UNSIGNED,
  provider: DataTypes.STRING(32),
  operation: DataTypes.STRING(16),
  provider_model: DataTypes.STRING(64),
  provider_request_id: DataTypes.STRING(128),
  prompt_version: DataTypes.STRING(64),
  pricing_version: DataTypes.STRING(64),
  status: DataTypes.STRING(16),
  input_tokens: DataTypes.BIGINT.UNSIGNED,
  cached_input_tokens: DataTypes.BIGINT.UNSIGNED,
  output_tokens: DataTypes.BIGINT.UNSIGNED,
  total_tokens: DataTypes.BIGINT.UNSIGNED,
  provider_cost_micros_usd: micros(),
  latency_ms: DataTypes.INTEGER.UNSIGNED,
  error_code: DataTypes.STRING(64),
  started_at: DataTypes.DATE,
  completed_at: DataTypes.DATE,
});

const AiRequestPayload = define('AiRequestPayload', 'mm_ai_request_payloads', {
  request_id: { ...requiredId(), primaryKey: true },
  payload_json: { type: DataTypes.JSON, allowNull: false },
  expires_at: { type: DataTypes.DATE, allowNull: false },
}, { updatedAt: false });

const AiReferenceInput = define('AiReferenceInput', 'mm_ai_reference_inputs', {
  id: id(),
  user_id: requiredId(),
  request_id: DataTypes.CHAR(36),
  status: DataTypes.STRING(32),
  relative_path: DataTypes.STRING(512),
  mime_type: DataTypes.STRING(64),
  width: DataTypes.INTEGER.UNSIGNED,
  height: DataTypes.INTEGER.UNSIGNED,
  byte_size: DataTypes.BIGINT.UNSIGNED,
  sha256: DataTypes.CHAR(64),
  expires_at: DataTypes.DATE,
  bound_at: DataTypes.DATE,
  deleted_at: DataTypes.DATE,
});

const AiOutput = define('AiOutput', 'mm_ai_outputs', {
  id: id(),
  request_id: requiredId(),
  sequence_no: DataTypes.INTEGER.UNSIGNED,
  status: DataTypes.STRING(32),
  relative_path: DataTypes.STRING(512),
  mime_type: DataTypes.STRING(64),
  width: DataTypes.INTEGER.UNSIGNED,
  height: DataTypes.INTEGER.UNSIGNED,
  byte_size: DataTypes.BIGINT.UNSIGNED,
  sha256: DataTypes.CHAR(64),
  provider_cost_micros_usd: micros(),
  expires_at: DataTypes.DATE,
  downloaded_at: DataTypes.DATE,
  deleted_at: DataTypes.DATE,
});

module.exports = {
  AiOutput,
  AiProviderCall,
  AiReferenceInput,
  AiRequest,
  AiRequestPayload,
  BillingOrder,
  MembershipEvent,
  MembershipPeriod,
  MembershipPlan,
  PaymentAttempt,
  PaymentEvent,
  PlanEntitlement,
  PointAccount,
  PointBatch,
  PointHold,
  PointHoldItem,
  PointLedger,
  UserMessage,
};
