const { Agent, fetch } = require('undici');

function createProviderTransport(timeoutMs) {
  const timeout = Math.max(1, Number(timeoutMs) || 1);
  const dispatcher = new Agent({
    headersTimeout: timeout,
    bodyTimeout: timeout,
  });

  return {
    fetch: (url, options = {}) => fetch(url, { ...options, dispatcher }),
    close: () => dispatcher.close(),
  };
}

module.exports = { createProviderTransport };
