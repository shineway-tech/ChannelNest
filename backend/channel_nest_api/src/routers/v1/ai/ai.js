const fs = require('fs');
const { PassThrough } = require('stream');
const { logger } = require('@honeykid/ml');
const AiLogic = require('../../../logics/ai');
const ErrorCodes = require('../../../utils/error_codes');

function writeEvent(stream, event) {
  if (!stream.destroyed) stream.write(`${JSON.stringify(event)}\n`);
}

class AiController {
  async text(ctx, next) {
    ctx.setData(await AiLogic.text(ctx.state.auth_user.id, ctx.state.entries));
    await next();
  }

  async textStream(ctx) {
    const output = new PassThrough();
    const abortController = new AbortController();
    ctx.status = 200;
    ctx.type = 'application/x-ndjson; charset=utf-8';
    ctx.set('Cache-Control', 'no-cache, no-transform');
    ctx.set('X-Accel-Buffering', 'no');
    ctx.body = output;

    ctx.res.once('close', () => {
      if (!output.writableEnded) abortController.abort();
    });

    setImmediate(async () => {
      try {
        const result = await AiLogic.text(ctx.state.auth_user.id, ctx.state.entries, {
          signal: abortController.signal,
          onDelta: async (content) => writeEvent(output, { type: 'delta', content }),
        });
        writeEvent(output, { type: 'done', data: result });
      } catch (error) {
        const knownError = Number.isInteger(error.errorCode);
        if (!knownError) logger.error(error);
        writeEvent(output, {
          type: 'error',
          code: knownError ? error.errorCode : ErrorCodes.AI_UNAVAILABLE,
          message: knownError
            ? error.message
            : '内容生成服务暂时不可用，积分未扣除，请稍后重试',
        });
      } finally {
        if (!output.destroyed) output.end();
      }
    });
  }

  async imageOptions(ctx, next) {
    ctx.setData(await AiLogic.imageOptions(ctx.state.auth_user.id));
    await next();
  }

  async images(ctx, next) {
    ctx.setData(await AiLogic.createImages(ctx.state.auth_user.id, ctx.state.entries));
    await next();
  }

  async optimizeImagePrompt(ctx, next) {
    ctx.setData(await AiLogic.optimizeImagePrompt(ctx.state.auth_user.id, ctx.state.entries));
    await next();
  }

  async request(ctx, next) {
    ctx.setData(await AiLogic.request(ctx.state.auth_user.id, ctx.params.request_id));
    await next();
  }

  async output(ctx) {
    const output = await AiLogic.output(
      ctx.state.auth_user.id,
      ctx.params.request_id,
      ctx.params.output_id,
    );
    ctx.type = output.mimeType;
    ctx.attachment(output.filename);
    ctx.body = fs.createReadStream(output.filePath);
  }

  async ack(ctx, next) {
    ctx.setData(await AiLogic.ack(ctx.state.auth_user.id, ctx.params.request_id));
    await next();
  }

  async ackOutput(ctx, next) {
    ctx.setData(await AiLogic.ackOutput(
      ctx.state.auth_user.id,
      ctx.params.request_id,
      ctx.params.output_id,
    ));
    await next();
  }

  async uploadReference(ctx, next) {
    const files = ctx.request.files || {};
    const file = Array.isArray(files.file) ? files.file[0] : files.file;
    ctx.setData(await AiLogic.uploadReference(ctx.state.auth_user.id, file));
    await next();
  }

  async deleteReference(ctx, next) {
    ctx.setData(await AiLogic.deleteReference(
      ctx.state.auth_user.id,
      ctx.params.reference_id,
    ));
    await next();
  }
}

module.exports = new AiController();
