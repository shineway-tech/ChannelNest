const OpenAI = require('openai');

function headerValue(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') return headers.get(name);
  return headers[name] || headers[name.toLowerCase()] || null;
}

function retryAfterMs(error) {
  const millisecondsHeader = headerValue(error && error.headers, 'retry-after-ms');
  const milliseconds = Number(millisecondsHeader);
  if (millisecondsHeader && Number.isFinite(milliseconds) && milliseconds >= 0) {
    return milliseconds;
  }

  const retryAfter = headerValue(error && error.headers, 'retry-after');
  if (!retryAfter) return null;
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const dateDelay = Date.parse(retryAfter) - Date.now();
  return Number.isFinite(dateDelay) && dateDelay >= 0 ? dateDelay : null;
}

function safeProviderValue(value, maxLength = 180) {
  if (value === undefined || value === null || value === '') return null;
  return String(value).replace(/[\r\n\t]+/g, ' ').slice(0, maxLength);
}

function providerErrorDetails(error) {
  const status = Number.isInteger(error && error.status) ? error.status : null;
  const name = safeProviderValue(error && error.name, 64) || 'Error';
  const code = safeProviderValue(
    error && (error.code || (error.cause && error.cause.code)),
    64,
  );
  const type = safeProviderValue(error && error.type, 64);
  const requestId = safeProviderValue(
    error && (error.requestID || error.request_id),
    128,
  );
  const aborted = ['AbortError', 'APIUserAbortError'].includes(name);
  const terminated = /^terminated$/i.test(String((error && error.message) || '').trim());
  const timedOut = error instanceof OpenAI.APIConnectionTimeoutError
    || name === 'APIConnectionTimeoutError'
    || terminated
    || [
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'UND_ERR_HEADERS_TIMEOUT',
      'UND_ERR_BODY_TIMEOUT',
    ].includes(code);
  const connectionError = name === 'APIConnectionError'
    || ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'].includes(code);
  const quotaExhausted = ['insufficient_quota', 'billing_hard_limit_reached'].includes(code);
  const configurationError = ['invalid_api_key', 'model_not_found'].includes(code);
  let kind = 'provider_error';

  if (aborted) kind = 'cancelled';
  else if (quotaExhausted) kind = 'quota_exhausted';
  else if (status === 429) kind = 'rate_limited';
  else if (timedOut || status === 408) kind = 'timed_out';
  else if (connectionError) kind = 'connection_error';
  else if (configurationError || [401, 403, 404].includes(status)) {
    kind = 'configuration_error';
  } else if ([400, 422].includes(status)) kind = 'request_rejected';
  else if (status >= 500) kind = 'provider_unavailable';

  return {
    kind,
    status,
    name,
    code,
    type,
    requestId,
    message: safeProviderValue(error && error.message),
    attempts: Number(error && error.providerAttempts) || 1,
    retryable: !aborted && (
      [408, 409, 429].includes(status)
      || status >= 500
      || timedOut
      || connectionError
    ),
    retryAfterMs: retryAfterMs(error),
  };
}

function providerErrorMessage(error) {
  const { kind } = providerErrorDetails(error);
  const messages = {
    cancelled: '生成已取消，积分未扣除',
    rate_limited: '当前生成请求较多，请稍后重试，积分未扣除',
    timed_out: '内容生成响应超时，请稍后重试，积分未扣除',
    connection_error: '内容生成服务连接异常，请稍后重试，积分未扣除',
    quota_exhausted: '内容生成服务额度不足，请联系管理员，积分未扣除',
    configuration_error: '内容生成服务配置异常，请联系管理员，积分未扣除',
    request_rejected: '当前内容暂时无法生成，请调整内容后重试，积分未扣除',
    provider_unavailable: '内容生成服务正在恢复，请稍后重试，积分未扣除',
  };
  return messages[kind] || '内容生成服务暂时不可用，积分未扣除，请稍后重试';
}

function imageTaskErrorCode(details) {
  const code = details && details.code;
  const message = String((details && details.message) || '');
  const rejectedBySafety = [
    'content_policy_violation',
    'moderation_blocked',
    'safety_violations',
  ].includes(code) || /(?:未生成图片|不能帮助|无法帮助|can't (?:help|assist)|cannot (?:help|assist))/i.test(message);

  if (rejectedBySafety) return 'content_rejected';
  if (details && details.kind === 'timed_out') return 'timed_out';
  return code || (details && details.kind) || 'provider_error';
}

module.exports = {
  imageTaskErrorCode,
  providerErrorDetails,
  providerErrorMessage,
};
