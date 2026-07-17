const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { logger } = require('@honeykid/ml');
const { Op } = require('sequelize');
const sequelize = require('../libs/sequelizor');
const {
  AiOutput,
  AiReferenceInput,
  AiRequest,
  AiRequestPayload,
} = require('../models/domain');
const { buildImagePrompt } = require('../services/image_prompt_builder');
const { fallbackCardPlans, planImageCards } = require('../services/image_card_planner');
const { Catalog } = require('../services/image_prompt_catalog');
const { providerSize, resolveDimensions } = require('../services/image_dimensions');
const OssTempStorage = require('../services/oss_temp_storage');
const { withImageRetries } = require('../services/image_retry');
const OpenAIService = require('../services/openai');
const { sha256 } = require('../utils/security');
const AiLifecycle = require('../logics/ai_request_lifecycle');
const MessageLogic = require('../logics/message');
const PointWallet = require('../logics/point_wallet');
const config = require('../../config');

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

async function failCall(id, startedAt, error, context) {
  const details = OpenAIService.providerErrorDetails(error);
  const taskErrorCode = OpenAIService.imageTaskErrorCode(details);
  logger.warn(`AI image provider call failed: ${JSON.stringify({
    ...context,
    ...details,
    taskErrorCode,
  })}`);
  await AiLifecycle.failProviderCall(id, {
    errorCode: taskErrorCode,
    startedAt,
  });
  return taskErrorCode;
}

async function touchHeartbeat(requestId) {
  try {
    await AiRequest.update({ heartbeat_at: new Date() }, { where: { id: requestId } });
  } catch (error) {
    logger.warn(`AI image heartbeat update failed: ${JSON.stringify({
      requestId,
      message: error.message,
    })}`);
  }
}

function startHeartbeat(requestId) {
  const interval = setInterval(() => {
    touchHeartbeat(requestId);
  }, 30 * 1000);
  if (typeof interval.unref === 'function') interval.unref();
  return () => clearInterval(interval);
}

function providerContext(request, references, providerImageSize, providerQuality) {
  return {
    taskId: request.id,
    operation: references.length ? 'edit' : 'generate',
    baseUrl: config.openai.base_url,
    endpoint: references.length ? '/v1/images/edits' : '/v1/images/generations',
    model: config.openai.image.model,
    resolution: request.resolution,
    size: providerImageSize,
    quality: providerQuality,
  };
}

function sequenceNumbers(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

async function cleanupBoundReferences(requestId, references, root) {
  if (!references.length) return;
  const now = new Date();
  for (const reference of references) {
    try {
      if (reference.relative_path) {
        const target = path.resolve(root, reference.relative_path);
        if (target.startsWith(`${root}${path.sep}`)) {
          await fs.promises.rm(target, { force: true });
        }
      }
      await AiReferenceInput.update({
        status: 'deleted',
        relative_path: null,
        deleted_at: now,
      }, { where: { id: reference.id, status: 'bound' } });
    } catch (error) {
      logger.warn(`AI image reference cleanup failed: ${JSON.stringify({
        taskId: requestId,
        referenceId: reference.id,
        message: error.message,
      })}`);
    }
  }
}

async function resolveCardPlans(request, payload) {
  const plannerInput = {
    userId: request.user_id,
    count: request.requested_count,
    assetType: request.asset_type,
    userContent: payload.prompt,
    style: payload.style || 'auto',
    layout: payload.layout || 'auto',
    palette: payload.palette || 'auto',
    preset: payload.preset || 'auto',
    language: payload.language,
    seriesStrategy: payload.series_strategy,
    cardNotes: payload.card_notes,
    createText: OpenAIService.createText,
  };

  try {
    return await planImageCards(plannerInput);
  } catch (error) {
    logger.warn(`AI image card planner failed, using fallback plan: ${JSON.stringify({
      taskId: request.id,
      message: error.message,
    })}`);
    return fallbackCardPlans(plannerInput);
  }
}

async function processSequence(context, sequenceNo) {
  const {
    request,
    payload,
    references,
    referencePaths,
    dimensions,
    providerImageSize,
    providerQuality,
    cardPlans,
    root,
  } = context;
  const callStarted = Date.now();
  const operation = references.length ? 'edit' : 'generate';
  let callId = null;

  try {
    callId = await AiLifecycle.recordProviderCallStart({
      requestId: request.id,
      sequenceNo,
      operation,
      model: config.openai.image.model,
      promptVersion: request.prompt_profile_version,
    });
    logger.info(`AI image provider request: ${JSON.stringify({
      ...providerContext(request, references, providerImageSize, providerQuality),
      sequenceNo,
    })}`);
    const prompt = buildImagePrompt({
      assetType: request.asset_type,
      userContent: payload.prompt,
      style: payload.style || 'auto',
      layout: payload.layout || 'auto',
      palette: payload.palette || 'auto',
      preset: payload.preset || 'auto',
      aspectRatio: request.aspect_ratio,
      outputWidth: dimensions.width,
      outputHeight: dimensions.height,
      language: payload.language,
      sequenceNo,
      count: request.requested_count,
      watermark: payload.watermark,
      cardPlan: cardPlans && cardPlans[sequenceNo - 1],
      referenceMode: payload.reference_mode || 'style',
      referenceCount: references.length,
    });
    const result = await withImageRetries(() => OpenAIService.createImage({
      prompt,
      providerSize: providerImageSize,
      providerQuality,
      referencePaths,
      idempotencyKey: `${request.id}-${sequenceNo}`,
    }), {
      maxRetries: config.openai.image.application_max_retries,
      classifyError: OpenAIService.providerErrorDetails,
    });
    const outputBuffer = await sharp(result.buffer)
      .resize(dimensions.width, dimensions.height, { fit: 'cover' })
      .jpeg({ quality: config.openai.image.output_compression })
      .toBuffer();
    if (!OssTempStorage.enabled()) {
      throw new Error('AI image OSS temp storage is not configured');
    }
    const outputId = crypto.randomUUID();
    const key = OssTempStorage.objectKey({
      userId: request.user_id,
      requestId: request.id,
      outputId,
    });
    await OssTempStorage.putObject(key, outputBuffer, 'image/jpeg');
    const relativePath = OssTempStorage.storedPath(key);
    const output = await AiOutput.create({
      id: outputId,
      request_id: request.id,
      sequence_no: sequenceNo,
      status: 'ready',
      relative_path: relativePath,
      mime_type: 'image/jpeg',
      width: dimensions.width,
      height: dimensions.height,
      byte_size: outputBuffer.length,
      sha256: sha256(outputBuffer),
      provider_cost_micros_usd: result.costMicrosUsd,
      expires_at: new Date(Date.now() + config.ai_temp_storage.ttl_seconds * 1000),
    });
    await AiLifecycle.completeProviderCall(callId, result, callStarted);
    return { output: plain(output), costMicrosUsd: result.costMicrosUsd, errorCode: null };
  } catch (error) {
    let errorCode = 'provider_error';
    try {
      if (callId) {
        errorCode = await failCall(callId, callStarted, error, {
          taskId: request.id,
          sequenceNo,
          operation,
          model: config.openai.image.model,
        });
      } else {
        const details = OpenAIService.providerErrorDetails(error);
        errorCode = OpenAIService.imageTaskErrorCode(details);
        logger.warn(`AI image provider call failed before call record: ${JSON.stringify({
          ...providerContext(request, references, providerImageSize, providerQuality),
          sequenceNo,
          ...details,
          taskErrorCode: errorCode,
        })}`);
      }
    } catch (recordError) {
      logger.warn(`AI image provider failure record failed: ${JSON.stringify({
        taskId: request.id,
        sequenceNo,
        message: recordError.message,
      })}`);
    }
    return { output: null, costMicrosUsd: 0, errorCode };
  } finally {
    await touchHeartbeat(request.id);
  }
}

class AiImageWorker {
  static async claim() {
    return sequelize.transaction(async (transaction) => {
      const request = await AiRequest.findOne({
        where: { request_type: 'image', status: 'pending' },
        order: [['created_at', 'ASC']],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true,
      });
      if (!request) return null;
      const payload = await AiRequestPayload.findOne({
        where: { request_id: request.id, expires_at: { [Op.gt]: new Date() } },
        transaction,
        lock: transaction.LOCK.UPDATE,
      });
      if (!payload) {
        await request.update({
          status: 'failed',
          failed_count: request.requested_count,
          error_code: 'payload_expired',
          completed_at: new Date(),
        }, { transaction });
        await PointWallet.release(request.hold_id, transaction);
        return null;
      }

      const result = { request: plain(request), payload: payload.payload_json };
      await request.update({ status: 'processing', started_at: new Date(), heartbeat_at: new Date() }, { transaction });
      await payload.destroy({ transaction });
      return result;
    });
  }

  static async runOne() {
    const job = await AiImageWorker.claim();
    if (!job) return false;

    const { request, payload } = job;
    const startedAt = Date.now();
    let totalCost = 0;
    let failureCode = null;
    let boundReferences = [];
    const root = path.resolve(config.ai_temp_storage.path);
    const stopHeartbeat = startHeartbeat(request.id);

    try {
      boundReferences = (await AiReferenceInput.findAll({
        where: { request_id: request.id, status: 'bound' }, order: [['created_at', 'ASC']],
      })).map(plain);
      const referencePaths = boundReferences.map((item) => path.resolve(root, item.relative_path));
      const dimensions = resolveDimensions(request.resolution, request.aspect_ratio);
      const providerImageSize = providerSize(request.resolution, request.aspect_ratio);
      const providerQuality = Catalog.resolutions[request.resolution].providerOptions.quality;
      const cardPlans = await resolveCardPlans(request, payload);
      const context = {
        request,
        payload,
        references: boundReferences,
        referencePaths,
        dimensions,
        providerImageSize,
        providerQuality,
        cardPlans,
        root,
      };
      const settled = await Promise.allSettled(
        sequenceNumbers(request.requested_count).map((sequenceNo) => (
          processSequence(context, sequenceNo)
        )),
      );
      const results = settled.map((item, index) => {
        if (item.status === 'fulfilled') return item.value;
        logger.warn(`AI image sequence failed unexpectedly: ${JSON.stringify({
          taskId: request.id,
          sequenceNo: index + 1,
          message: item.reason && item.reason.message,
        })}`);
        return { output: null, costMicrosUsd: 0, errorCode: 'provider_error' };
      });
      const successful = results
        .filter((item) => item.output)
        .map((item) => item.output)
        .sort((a, b) => a.sequence_no - b.sequence_no);
      totalCost = results.reduce((sum, item) => sum + item.costMicrosUsd, 0);
      failureCode = results.find((item) => item.errorCode)?.errorCode || null;

      const price = Catalog.resolutions[request.resolution].priceMicros;
      const charged = successful.length * price;
      let status = 'failed';
      if (successful.length === request.requested_count) status = 'succeeded';
      else if (successful.length) status = 'partial';
      await sequelize.transaction(async (transaction) => {
        await PointWallet.settle(request.hold_id, charged, transaction);
        await AiRequest.update({
          status,
          success_count: successful.length,
          failed_count: request.requested_count - successful.length,
          charged_micros: charged,
          provider_cost_micros_usd: totalCost,
          latency_ms: Date.now() - startedAt,
          error_code: successful.length ? null : failureCode || 'provider_error',
          completed_at: new Date(),
        }, { where: { id: request.id }, transaction });
        await MessageLogic.create({
          userId: request.user_id,
          category: 'ai',
          level: successful.length ? 'success' : 'error',
          templateCode: successful.length ? 'ai_completed' : 'ai_failed',
          actionCode: 'open_ai_request',
          actionRefId: request.id,
          dedupeKey: `ai:${request.id}:${status}`,
        }, transaction);
      });
    } catch (error) {
      await sequelize.transaction(async (transaction) => {
        await PointWallet.release(request.hold_id, transaction);
        await AiRequest.update({
          status: 'failed',
          failed_count: request.requested_count,
          provider_cost_micros_usd: totalCost,
          error_code: failureCode || 'provider_error',
          latency_ms: Date.now() - startedAt,
          completed_at: new Date(),
        }, { where: { id: request.id }, transaction });
        await MessageLogic.create({
          userId: request.user_id,
          category: 'ai',
          level: 'error',
          templateCode: 'ai_failed',
          actionCode: 'open_ai_request',
          actionRefId: request.id,
          dedupeKey: `ai:${request.id}:failed`,
        }, transaction);
      });
    } finally {
      stopHeartbeat();
      await cleanupBoundReferences(request.id, boundReferences, root);
    }

    return true;
  }
}

module.exports = AiImageWorker;
