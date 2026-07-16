const OpenAI = require('openai');
const config = require('../../config');
const { createProviderTransport } = require('./provider_http');

let client;
let imageTransport;
let textClient;

function createClient(apiKey, baseURL, includeProject = false) {
  return new OpenAI({
    apiKey,
    baseURL,
    organization: includeProject ? config.openai.organization_id || undefined : undefined,
    project: includeProject ? config.openai.project_id || undefined : undefined,
    maxRetries: config.openai.sdk_max_retries,
  });
}

function api() {
  if (!config.openai.api_key) throw new Error('OpenAI service is not configured');
  if (!client) {
    client = createClient(config.openai.api_key, config.openai.base_url, true);
  }

  return client;
}

function imageHttp() {
  if (!config.openai.api_key) throw new Error('OpenAI service is not configured');
  if (!imageTransport) imageTransport = createProviderTransport(config.openai.image.timeout_ms);

  return imageTransport;
}

function imageEndpoint(pathname) {
  return `${config.openai.base_url.replace(/\/$/, '')}/${pathname.replace(/^\//, '')}`;
}

function imageHeaders(idempotencyKey, json = false) {
  const headers = { Authorization: `Bearer ${config.openai.api_key}` };
  if (json) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  return headers;
}

function textApi() {
  const textConfig = config.openai.text;
  if (!textConfig.api_key && !textConfig.base_url) return api();
  const apiKey = textConfig.api_key || config.openai.api_key;
  const baseURL = textConfig.base_url || config.openai.base_url;
  if (!apiKey) throw new Error('Text generation service is not configured');
  if (!textClient) textClient = createClient(apiKey, baseURL);
  return textClient;
}

module.exports = {
  imageEndpoint,
  imageHeaders,
  imageHttp,
  textApi,
};
