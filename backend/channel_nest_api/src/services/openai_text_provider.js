const config = require('../../config');
const { hmac } = require('../utils/security');
const { textApi } = require('./openai_client');
const { providerCostMicros, usageOf } = require('./provider_cost');
const { providerErrorDetails } = require('./provider_errors');

function safetyIdentifier(userId) {
  return hmac(userId, config.openai.safety_identifier_hmac_pepper);
}

function textRequest(input) {
  const textConfig = config.openai.text;

  return {
    model: textConfig.model,
    instructions: input.instructions,
    input: input.content,
    reasoning: { effort: textConfig.reasoning_effort },
    max_output_tokens: textConfig.max_output_tokens,
    store: textConfig.store,
    service_tier: textConfig.service_tier,
    safety_identifier: safetyIdentifier(input.userId),
  };
}

function textChatRequest(input) {
  const textConfig = config.openai.text;

  return {
    model: textConfig.model,
    messages: [
      { role: 'system', content: input.instructions },
      { role: 'user', content: input.content },
    ],
    max_tokens: textConfig.max_output_tokens,
    enable_thinking: textConfig.enable_thinking,
  };
}

function textResult(response, text) {
  const usage = usageOf(response);

  return {
    id: response.id,
    model: response.model || config.openai.text.model,
    text,
    usage,
    costMicrosUsd: providerCostMicros(usage),
  };
}

function abortError() {
  const error = new Error('Request was aborted');
  error.name = 'AbortError';
  return error;
}

function wait(milliseconds, signal) {
  if (signal && signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    let timer;
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    if (!signal) return;
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function withTextRetries(operation, input, canRetry = () => true, attempt = 0) {
  const maxRetries = Math.max(0, Number(config.openai.text.application_max_retries) || 0);
  try {
    const result = await operation();
    return { ...result, attempts: attempt + 1 };
  } catch (error) {
    error.providerAttempts = attempt + 1;
    const details = providerErrorDetails(error);
    if (attempt >= maxRetries || !canRetry() || !details.retryable) throw error;
    const configuredDelay = details.retryAfterMs;
    const fallbackDelay = 500 * (2 ** attempt);
    await wait(Math.min(configuredDelay ?? fallbackDelay, 5000), input.signal);
    return withTextRetries(operation, input, canRetry, attempt + 1);
  }
}

function sanitizeGeneratedText(value, final = false) {
  let result = value
    .replace(/:{3,}writing\{[^}\r\n]*\}/gi, '')
    .replace(/^\s*:{3,}\s*$/gim, '')
    .replace(/^(?:下面|以下)(?:是|为)[^\r\n]{0,120}(?:要求|内容|文案|故事)[：:]\s*/, '')
    .replace(/^Here (?:is|are)[^\r\n]{0,120}:\s*/i, '');
  if (final) {
    return result.replace(/:{3,}writing(?:\{[^}\r\n]*)?$/gi, '');
  }

  const partialColons = /:{1,2}$/.exec(result);
  if (partialColons) result = result.slice(0, partialColons.index);
  const marker = /:{3,}[^\r\n]*$/.exec(result);
  const markerIndex = marker ? marker.index : -1;
  const shouldHoldPreamble = () => (
    /^(?:(?:下面|以下)(?:是|为)|Here (?:is|are))/i.test(result)
      && !/[\r\n]/.test(result)
      && result.length <= 140
  );
  if (markerIndex < 0) return shouldHoldPreamble() ? '' : result;
  const suffix = result.slice(markerIndex);
  const markerBody = suffix.replace(/^:{3,}/, '');
  const partialName = markerBody && 'writing'.startsWith(markerBody.toLowerCase());
  const partialAttributes = /^writing\{[^}\r\n]*$/i.test(markerBody);
  if (!markerBody || partialName || partialAttributes) result = result.slice(0, markerIndex);
  return shouldHoldPreamble() ? '' : result;
}

function sanitizedEmitter(onDelta) {
  let rawText = '';
  let emittedText = '';

  const emit = async (final = false) => {
    const text = sanitizeGeneratedText(rawText, final);
    if (!text.startsWith(emittedText)) return text;
    const delta = text.slice(emittedText.length);
    if (delta) {
      emittedText = text;
      await onDelta(delta);
    }
    return text;
  };

  return {
    append: async (delta) => {
      rawText += delta;
      return emit();
    },
    finish: () => emit(true),
  };
}

async function createText(input) {
  const textConfig = config.openai.text;
  return withTextRetries(async () => {
    if (textConfig.api === 'chat_completions') {
      const response = await textApi().chat.completions.create(
        textChatRequest(input),
        { timeout: textConfig.timeout_ms },
      );
      const content = response.choices?.[0]?.message?.content || '';
      return textResult(response, sanitizeGeneratedText(content, true));
    }
    const response = await textApi().responses.create(
      textRequest(input),
      { timeout: textConfig.timeout_ms },
    );
    return textResult(response, sanitizeGeneratedText(response.output_text || '', true));
  }, input);
}

async function createTextStreamAttempt(input) {
  const textConfig = config.openai.text;
  if (textConfig.api === 'chat_completions') {
    const stream = await textApi().chat.completions.create({
      ...textChatRequest(input),
      stream: true,
      stream_options: { include_usage: true },
    }, { timeout: textConfig.timeout_ms, signal: input.signal });
    const response = { id: null, model: textConfig.model, usage: null };
    const emitter = sanitizedEmitter(input.onDelta);

    for await (const chunk of stream) {
      response.id = response.id || chunk.id;
      response.model = chunk.model || response.model;
      response.usage = chunk.usage || response.usage;
      const delta = chunk.choices?.[0]?.delta?.content;
      if (delta) await emitter.append(delta);
    }

    return textResult(response, await emitter.finish());
  }
  const stream = await textApi().responses.create(
    { ...textRequest(input), stream: true },
    { timeout: textConfig.timeout_ms, signal: input.signal },
  );
  let response;
  const emitter = sanitizedEmitter(input.onDelta);

  for await (const event of stream) {
    if (event.type === 'response.output_text.delta' && event.delta) {
      await emitter.append(event.delta);
    } else if (event.type === 'response.completed' || event.type === 'response.incomplete') {
      response = event.response;
    } else if (event.type === 'response.failed') {
      const error = new Error(event.response?.error?.message || 'Model response failed');
      error.name = 'ProviderResponseError';
      error.status = 502;
      error.code = event.response?.error?.code;
      throw error;
    } else if (event.type === 'error') {
      const error = new Error(event.message || 'Model stream failed');
      error.name = 'ProviderResponseError';
      error.status = 502;
      error.code = event.code;
      throw error;
    }
  }

  if (!response) throw new Error('Model stream ended without a final response');
  const text = await emitter.finish();
  return textResult(response, text);
}

async function createTextStream(input) {
  let emitted = false;
  return withTextRetries(() => createTextStreamAttempt({
    ...input,
    onDelta: async (delta) => {
      emitted = true;
      if (input.onDelta) await input.onDelta(delta);
    },
  }), input, () => !emitted);
}

module.exports = {
  createText,
  createTextStream,
  sanitizeGeneratedText,
};
