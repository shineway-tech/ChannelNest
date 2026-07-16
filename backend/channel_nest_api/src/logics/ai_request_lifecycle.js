const crypto = require('crypto');
const { logger } = require('@honeykid/ml');
const sequelize = require('../libs/sequelizor');
const {
  AiProviderCall,
  AiRequest,
} = require('../models/domain');
const config = require('../../config');
const PointWallet = require('./point_wallet');

async function recordProviderCallStart({
  requestId,
  sequenceNo = 0,
  provider = 'openai',
  operation,
  model,
  promptVersion,
}) {
  const id = crypto.randomUUID();
  await AiProviderCall.create({
    id,
    request_id: requestId,
    sequence_no: sequenceNo,
    attempt_no: 1,
    provider,
    operation,
    provider_model: model,
    prompt_version: promptVersion,
    pricing_version: config.openai.pricing.version,
    status: 'started',
    provider_cost_micros_usd: 0,
    started_at: new Date(),
  });

  return id;
}

async function completeProviderCall(callId, result, startedAt, transaction = null) {
  await AiProviderCall.update({
    attempt_no: result.attempts,
    provider_request_id: result.id,
    provider_model: result.model,
    status: 'succeeded',
    input_tokens: result.usage.inputTokens,
    cached_input_tokens: result.usage.cachedInputTokens,
    output_tokens: result.usage.outputTokens,
    total_tokens: result.usage.totalTokens,
    provider_cost_micros_usd: result.costMicrosUsd,
    latency_ms: Date.now() - startedAt,
    completed_at: new Date(),
  }, { where: { id: callId }, transaction });
}

async function failProviderCall(callId, {
  attempts = 1,
  errorCode,
  startedAt,
  transaction = null,
}) {
  await AiProviderCall.update({
    attempt_no: attempts,
    status: 'failed',
    error_code: errorCode,
    latency_ms: Date.now() - startedAt,
    completed_at: new Date(),
  }, { where: { id: callId }, transaction });
}

async function failTextRequest({
  requestId,
  holdId,
  callId,
  errorCode,
  attempts = 1,
  startedAt,
}) {
  try {
    await sequelize.transaction(async (transaction) => {
      await PointWallet.release(holdId, transaction);
      await failProviderCall(callId, {
        attempts,
        errorCode,
        startedAt,
        transaction,
      });
      await AiRequest.update({
        status: 'failed',
        failed_count: 1,
        error_code: errorCode,
        latency_ms: Date.now() - startedAt,
        completed_at: new Date(),
      }, { where: { id: requestId }, transaction });
    });
  } catch (error) {
    logger.error(`Failed to release AI text hold (${requestId}): ${error.message}`);
  }
}

module.exports = {
  completeProviderCall,
  failProviderCall,
  failTextRequest,
  recordProviderCallStart,
};
