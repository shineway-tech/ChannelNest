/* eslint-disable no-await-in-loop */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { Op } = require('sequelize');
const { logger } = require('@honeykid/ml');
const { BadArgumentError, NotFoundError } = require('@honeykid/ml/errors');
const sequelize = require('../libs/sequelizor');
const {
  AiOutput,
  AiReferenceInput,
  AiRequest,
  AiRequestPayload,
} = require('../models/domain');
const OpenAIService = require('../services/openai');
const { Catalog } = require('../services/image_prompt_catalog');
const { resolveDimensions } = require('../services/image_dimensions');
const { ackImageOutputFile } = require('../services/image_output_cleanup');
const OssTempStorage = require('../services/oss_temp_storage');
const {
  buildTextContent,
  buildTextInstructions,
} = require('../services/text_prompt_builder');
const {
  buildImagePromptOptimizeContent,
  buildImagePromptOptimizeInstructions,
} = require('../services/image_prompt_optimizer');
const BusinessError = require('../utils/business_error');
const ErrorCodes = require('../utils/error_codes');
const { sha256 } = require('../utils/security');
const AiLifecycle = require('./ai_request_lifecycle');
const EntitlementLogic = require('./entitlement');
const PointWallet = require('./point_wallet');
const config = require('../../config');

const TextPriceMicros = 2000;

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

function publicRequest(request, outputs = []) {
  return {
    requestId: request.id,
    type: request.request_type,
    taskType: request.task_type,
    assetType: request.asset_type,
    status: request.status,
    resolution: request.resolution,
    aspectRatio: request.aspect_ratio,
    requestedCount: request.requested_count,
    successCount: request.success_count,
    failedCount: request.failed_count,
    chargedMicros: String(request.charged_micros || 0),
    style: request.style_code,
    layout: request.layout_code,
    palette: request.palette_code,
    preset: request.preset_code,
    errorCode: request.error_code,
    completedAt: request.completed_at,
    outputs: outputs.map((output) => {
      const objectKey = OssTempStorage.parseStoredPath(output.relative_path);
      return {
        id: output.id,
        status: output.status,
        sequenceNo: output.sequence_no,
        width: output.width,
        height: output.height,
        byteSize: String(output.byte_size),
        sha256: output.sha256,
        expiresAt: output.expires_at,
        downloadUrl: objectKey ? OssTempStorage.signedUrl(objectKey) : null,
      };
    }),
  };
}

class AiLogic {
  static ensureConfigured() {
    if (!OpenAIService.isConfigured()) {
      throw new BusinessError(
        503,
        ErrorCodes.AI_NOT_CONFIGURED,
        '内容生成服务尚未配置，请联系管理员',
      );
    }
  }

  static async text(userId, entries, streamOptions = null) {
    AiLogic.ensureConfigured();
    await EntitlementLogic.require(userId, 'ai.text');
    const existing = plain(await AiRequest.findOne({
      where: { user_id: userId, client_request_id: entries.client_request_id },
    }));
    if (existing) return publicRequest(existing);

    const requestId = crypto.randomUUID();
    let hold;
    await sequelize.transaction(async (transaction) => {
      hold = await PointWallet.freeze({
        userId,
        businessType: 'ai_text',
        businessId: requestId,
        amountMicros: TextPriceMicros,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      }, transaction);
      await AiRequest.create({
        id: requestId,
        user_id: userId,
        client_request_id: entries.client_request_id,
        request_type: 'text',
        task_type: entries.task_type,
        reference_count: 0,
        requested_count: 1,
        success_count: 0,
        failed_count: 0,
        status: 'processing',
        hold_id: hold.id,
        charged_micros: 0,
        provider: config.openai.text.provider,
        provider_model: config.openai.text.model,
        provider_cost_micros_usd: 0,
        input_length: entries.input.length,
        output_length: 0,
        started_at: new Date(),
      }, { transaction });
    });

    const startedAt = Date.now();
    const callId = await AiLifecycle.recordProviderCallStart({
      requestId,
      provider: config.openai.text.provider,
      operation: config.openai.text.api === 'chat_completions' ? 'chat' : 'responses',
      model: config.openai.text.model,
      promptVersion: config.openai.text.prompt_version,
    });

    const failRequest = async (errorCode, attempts = 1) => {
      await AiLifecycle.failTextRequest({
        requestId,
        holdId: hold.id,
        callId,
        errorCode,
        attempts,
        startedAt,
      });
    };
    const createText = streamOptions ? OpenAIService.createTextStream : OpenAIService.createText;
    let result;

    try {
      result = await createText({
        userId,
        instructions: buildTextInstructions(entries),
        content: buildTextContent(entries),
        onDelta: streamOptions?.onDelta,
        signal: streamOptions?.signal,
      });
      if (!result.text.trim()) throw new Error('Empty model response');
    } catch (error) {
      const details = OpenAIService.providerErrorDetails(error);
      const errorCode = details.kind === 'provider_error'
        ? details.kind : `provider_${details.kind}`;
      logger.warn(`OpenAI text generation failed: ${JSON.stringify({
        requestId,
        ...details,
      })}`);
      await failRequest(errorCode, details.attempts);
      throw new BusinessError(
        503,
        ErrorCodes.AI_UNAVAILABLE,
        OpenAIService.providerErrorMessage(error),
      );
    }

    try {
      const completedAt = new Date();
      await sequelize.transaction(async (transaction) => {
        await PointWallet.settle(hold.id, TextPriceMicros, transaction);
        await AiLifecycle.completeProviderCall(callId, result, startedAt, transaction);
        await AiRequest.update({
          status: 'succeeded',
          success_count: 1,
          charged_micros: TextPriceMicros,
          provider_model: result.model,
          provider_cost_micros_usd: result.costMicrosUsd,
          output_length: result.text.length,
          latency_ms: Date.now() - startedAt,
          completed_at: completedAt,
        }, { where: { id: requestId }, transaction });
      });
    } catch (error) {
      const validation = Array.isArray(error.errors)
        ? error.errors.map((item) => ({
          type: item.type,
          path: item.path,
          validatorKey: item.validatorKey,
          message: item.message,
        }))
        : [];
      logger.error(`Failed to settle AI text request (${requestId}): ${JSON.stringify({
        name: error.name,
        code: error.original?.code,
        message: error.message,
        validation,
      })}`);
      await failRequest('result_processing_error', result.attempts);
      throw new BusinessError(
        503,
        ErrorCodes.AI_UNAVAILABLE,
        '生成结果处理失败，积分未扣除，请稍后重试',
      );
    }

    let wallet = null;
    try {
      wallet = await PointWallet.balance(userId);
    } catch (error) {
      logger.warn(`Failed to read AI text wallet balance (${requestId}): ${error.message}`);
    }
    return {
      requestId,
      content: result.text,
      chargedMicros: String(TextPriceMicros),
      wallet,
    };
  }

  static async optimizeImagePrompt(userId, entries) {
    AiLogic.ensureConfigured();
    await EntitlementLogic.require(userId, 'ai.text');
    const existing = plain(await AiRequest.findOne({
      where: { user_id: userId, client_request_id: entries.client_request_id },
    }));
    if (existing) {
      return {
        requestId: existing.id,
        optimizedPrompt: '',
        chargedMicros: String(existing.charged_micros || 0),
        wallet: null,
      };
    }

    const requestId = crypto.randomUUID();
    let hold;
    await sequelize.transaction(async (transaction) => {
      hold = await PointWallet.freeze({
        userId,
        businessType: 'ai_prompt_optimize',
        businessId: requestId,
        amountMicros: TextPriceMicros,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      }, transaction);
      await AiRequest.create({
        id: requestId,
        user_id: userId,
        client_request_id: entries.client_request_id,
        request_type: 'text',
        task_type: 'image_prompt_optimize',
        asset_type: entries.asset_type,
        style_code: entries.style || 'auto',
        layout_code: entries.layout || 'auto',
        palette_code: entries.palette || 'auto',
        preset_code: entries.preset || 'auto',
        reference_count: Number(entries.reference_count || 0),
        aspect_ratio: entries.aspect_ratio,
        requested_count: 1,
        success_count: 0,
        failed_count: 0,
        status: 'processing',
        hold_id: hold.id,
        charged_micros: 0,
        provider: config.openai.text.provider,
        provider_model: config.openai.text.model,
        provider_cost_micros_usd: 0,
        input_length: entries.prompt.length,
        output_length: 0,
        started_at: new Date(),
      }, { transaction });
    });

    const startedAt = Date.now();
    const callId = await AiLifecycle.recordProviderCallStart({
      requestId,
      provider: config.openai.text.provider,
      operation: config.openai.text.api === 'chat_completions' ? 'chat' : 'responses',
      model: config.openai.text.model,
      promptVersion: `${config.openai.text.prompt_version}:image-prompt-optimize-v1`,
    });

    const failRequest = async (errorCode, attempts = 1) => {
      await AiLifecycle.failTextRequest({
        requestId,
        holdId: hold.id,
        callId,
        errorCode,
        attempts,
        startedAt,
      });
    };
    let result;

    try {
      result = await OpenAIService.createText({
        userId,
        instructions: buildImagePromptOptimizeInstructions(entries),
        content: buildImagePromptOptimizeContent(entries),
      });
      result.text = result.text.trim();
      if (!result.text) throw new Error('Empty model response');
    } catch (error) {
      const details = OpenAIService.providerErrorDetails(error);
      const errorCode = details.kind === 'provider_error'
        ? details.kind : `provider_${details.kind}`;
      logger.warn(`OpenAI image prompt optimization failed: ${JSON.stringify({
        requestId,
        ...details,
      })}`);
      await failRequest(errorCode, details.attempts);
      throw new BusinessError(
        503,
        ErrorCodes.AI_UNAVAILABLE,
        OpenAIService.providerErrorMessage(error),
      );
    }

    try {
      const completedAt = new Date();
      await sequelize.transaction(async (transaction) => {
        await PointWallet.settle(hold.id, TextPriceMicros, transaction);
        await AiLifecycle.completeProviderCall(callId, result, startedAt, transaction);
        await AiRequest.update({
          status: 'succeeded',
          success_count: 1,
          charged_micros: TextPriceMicros,
          provider_model: result.model,
          provider_cost_micros_usd: result.costMicrosUsd,
          output_length: result.text.length,
          latency_ms: Date.now() - startedAt,
          completed_at: completedAt,
        }, { where: { id: requestId }, transaction });
      });
    } catch (error) {
      const validation = Array.isArray(error.errors)
        ? error.errors.map((item) => ({
          type: item.type,
          path: item.path,
          validatorKey: item.validatorKey,
          message: item.message,
        }))
        : [];
      logger.error(`Failed to settle AI image prompt optimization (${requestId}): ${JSON.stringify({
        name: error.name,
        code: error.original?.code,
        message: error.message,
        validation,
      })}`);
      await failRequest('result_processing_error', result.attempts);
      throw new BusinessError(
        503,
        ErrorCodes.AI_UNAVAILABLE,
        '提示词优化结果处理失败，积分未扣除，请稍后重试',
      );
    }

    let wallet = null;
    try {
      wallet = await PointWallet.balance(userId);
    } catch (error) {
      logger.warn(`Failed to read AI prompt optimization wallet balance (${requestId}): ${error.message}`);
    }
    return {
      requestId,
      optimizedPrompt: result.text,
      chargedMicros: String(TextPriceMicros),
      wallet,
    };
  }

  static async imageOptions(userId) {
    const entitlement = await EntitlementLogic.snapshot(userId);

    return {
      assetTypes: Catalog.assetTypes,
      styles: Catalog.styleOptions,
      layouts: Catalog.layoutOptions,
      palettes: Catalog.paletteOptions,
      presets: Catalog.presetOptions,
      aspectRatios: Catalog.aspectRatioOptions,
      resolutions: Object.entries(Catalog.resolutions).map(([code, item]) => ({
        code,
        priceMicros: String(item.priceMicros),
        allowed: Boolean(entitlement.capabilities[item.capability]?.allowed),
      })),
      limits: { maxCount: 4, maxReferenceImages: config.openai.image.max_reference_images },
    };
  }

  static async createImages(userId, entries) {
    AiLogic.ensureConfigured();
    const resolutionConfig = Catalog.resolutions[entries.resolution];
    await EntitlementLogic.require(userId, resolutionConfig.capability);
    const existing = plain(await AiRequest.findOne({
      where: { user_id: userId, client_request_id: entries.client_request_id },
    }));
    if (existing) return publicRequest(existing);
    const dimensions = resolveDimensions(entries.resolution, entries.aspect_ratio);
    const requestId = crypto.randomUUID();
    const referenceIds = entries.reference_ids || [];
    const totalMicros = resolutionConfig.priceMicros * entries.count;
    let hold;

    await sequelize.transaction(async (transaction) => {
      const references = referenceIds.length ? await AiReferenceInput.findAll({
        where: {
          id: { [Op.in]: referenceIds },
          user_id: userId,
          status: 'uploaded',
          expires_at: { [Op.gt]: new Date() },
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
      }) : [];
      if (references.length !== referenceIds.length) {
        throw new BadArgumentError('参考图无效或已过期');
      }
      hold = await PointWallet.freeze({
        userId,
        businessType: `ai_image_${entries.resolution}`,
        businessId: requestId,
        amountMicros: totalMicros,
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      }, transaction);
      await AiRequest.create({
        id: requestId,
        user_id: userId,
        client_request_id: entries.client_request_id,
        request_type: 'image',
        task_type: 'image',
        asset_type: entries.asset_type,
        prompt_profile_version: config.openai.image.prompt_profile_version,
        style_code: entries.style || 'auto',
        layout_code: entries.layout || 'auto',
        palette_code: entries.palette || 'auto',
        preset_code: entries.preset || 'auto',
        reference_count: referenceIds.length,
        resolution: entries.resolution,
        aspect_ratio: entries.aspect_ratio,
        requested_count: entries.count,
        success_count: 0,
        failed_count: 0,
        status: 'pending',
        hold_id: hold.id,
        charged_micros: 0,
        provider: 'openai',
        provider_model: config.openai.image.model,
        provider_cost_micros_usd: 0,
        input_length: entries.prompt.length,
        output_length: 0,
      }, { transaction });
      await AiRequestPayload.create({
        request_id: requestId,
        payload_json: entries,
        expires_at: new Date(Date.now() + 15 * 60 * 1000),
      }, { transaction });
      if (referenceIds.length) {
        await AiReferenceInput.update({
          request_id: requestId, status: 'bound', bound_at: new Date(),
        }, { where: { id: { [Op.in]: referenceIds } }, transaction });
      }
    });

    return {
      requestId,
      status: 'pending',
      assetType: entries.asset_type,
      resolution: entries.resolution,
      aspectRatio: entries.aspect_ratio,
      outputWidth: dimensions.width,
      outputHeight: dimensions.height,
      requestedCount: entries.count,
      frozenMicros: String(totalMicros),
    };
  }

  static async request(userId, requestId) {
    const request = plain(await AiRequest.findOne({ where: { id: requestId, user_id: userId } }));
    if (!request) throw new NotFoundError('生成任务不存在');
    const outputs = await AiOutput.findAll({
      where: { request_id: requestId, status: { [Op.in]: ['ready', 'downloaded'] } },
      order: [['sequence_no', 'ASC']],
    });

    return publicRequest(request, outputs);
  }

  static async ack(userId, requestId) {
    const request = await AiRequest.findOne({ where: { id: requestId, user_id: userId } });
    if (!request) throw new NotFoundError('生成任务不存在');
    const outputs = await AiOutput.findAll({ where: { request_id: requestId, status: 'ready' } });
    for (const output of outputs) {
      await ackImageOutputFile(output);
    }

    return { acknowledged: true };
  }

  static async ackOutput(userId, requestId, outputId) {
    const request = await AiRequest.findOne({ where: { id: requestId, user_id: userId } });
    const output = await AiOutput.findOne({
      where: { id: outputId, request_id: requestId },
    });
    if (!request || !output || !['ready', 'downloaded'].includes(output.status)) {
      throw new NotFoundError('图片不存在或已过期');
    }
    if (output.status === 'ready') {
      await ackImageOutputFile(output);
    }

    return { acknowledged: true };
  }

  static async uploadReference(userId, file) {
    const sourcePath = file && (file.filepath || file.path);
    if (!sourcePath) throw new BadArgumentError('请选择参考图片');
    if (Number(file.size || 0) > 10 * 1024 * 1024) throw new BadArgumentError('参考图不能超过 10 MB');
    const id = crypto.randomUUID();
    const relativePath = path.join('references', userId, `${id}.jpg`);
    const target = path.resolve(config.ai_temp_storage.path, relativePath);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });

    try {
      const image = sharp(sourcePath, { limitInputPixels: 40000000 });
      const metadata = await image.metadata();
      if (!['jpeg', 'png'].includes(metadata.format) || !metadata.width || !metadata.height) {
        throw new BadArgumentError('仅支持有效的 JPEG 或 PNG 图片');
      }
      await image.rotate().jpeg({ quality: 92 }).toFile(target);
      const buffer = await fs.promises.readFile(target);
      await AiReferenceInput.create({
        id,
        user_id: userId,
        status: 'uploaded',
        relative_path: relativePath,
        mime_type: 'image/jpeg',
        width: metadata.autoOrient ? metadata.autoOrient.width : metadata.width,
        height: metadata.autoOrient ? metadata.autoOrient.height : metadata.height,
        byte_size: buffer.length,
        sha256: sha256(buffer),
        expires_at: new Date(Date.now() + config.ai_temp_storage.ttl_seconds * 1000),
      });

      return {
        referenceId: id,
        width: metadata.width,
        height: metadata.height,
        expiresIn: config.ai_temp_storage.ttl_seconds,
      };
    } catch (error) {
      await fs.promises.rm(target, { force: true });
      throw error;
    } finally {
      await fs.promises.rm(sourcePath, { force: true });
    }
  }

  static async deleteReference(userId, referenceId) {
    const reference = plain(await AiReferenceInput.findOne({
      where: { id: referenceId, user_id: userId, status: 'uploaded' },
    }));
    if (!reference) throw new NotFoundError('参考图不存在或已被使用');
    const root = path.resolve(config.ai_temp_storage.path);
    const filePath = path.resolve(root, reference.relative_path);
    if (filePath.startsWith(`${root}${path.sep}`)) await fs.promises.rm(filePath, { force: true });
    await AiReferenceInput.update({
      status: 'deleted', relative_path: null, deleted_at: new Date(),
    }, { where: { id: referenceId } });

    return { deleted: true };
  }
}

module.exports = AiLogic;
