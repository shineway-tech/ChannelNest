function sleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function retryDelay(details, attempt) {
  const retryAfter = Number(details && details.retryAfterMs);
  if (Number.isFinite(retryAfter) && retryAfter >= 0) return Math.min(retryAfter, 5000);
  return Math.min(500 * (2 ** attempt), 5000);
}

async function withImageRetries(operation, options = {}, attempt = 0) {
  const maxRetries = Math.max(0, Number(options.maxRetries) || 0);
  const classifyError = options.classifyError || (() => ({ retryable: false }));
  const wait = options.wait || sleep;

  try {
    const result = await operation();
    return { ...result, attempts: attempt + 1 };
  } catch (error) {
    error.providerAttempts = attempt + 1;
    const details = classifyError(error);
    if (attempt >= maxRetries || !details.retryable) throw error;
    await wait(retryDelay(details, attempt));
    return withImageRetries(operation, options, attempt + 1);
  }
}

module.exports = {
  retryDelay,
  withImageRetries,
};
