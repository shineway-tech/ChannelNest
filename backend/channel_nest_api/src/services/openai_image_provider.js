const { Blob } = require('buffer');
const fs = require('fs');
const { FormData } = require('undici');
const config = require('../../config');
const { imageEndpoint, imageHeaders, imageHttp } = require('./openai_client');
const { providerCostMicros, usageOf } = require('./provider_cost');

function imageDownloadHosts() {
  const hosts = new Set();
  try {
    const baseHost = new URL(config.openai.base_url).hostname.toLowerCase();
    hosts.add(baseHost);
    if (baseHost.startsWith('relay-api.')) hosts.add(baseHost.replace(/^relay-api\./, 'api.'));
  } catch (error) {
    // Ignore invalid base URLs here; the provider request will fail with a clearer error.
  }
  const configured = config.openai.image.image_download_hosts
    || config.openai.image.download_hosts
    || [];
  configured.forEach((host) => {
    if (host) hosts.add(String(host).toLowerCase());
  });
  return hosts;
}

async function imageProviderError(response) {
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  const details = payload && (payload.error || payload);
  const error = new Error(details && details.message
    ? details.message
    : `Image provider rejected the request with status ${response.status}`);
  error.name = 'APIError';
  error.status = response.status;
  error.code = details && details.code;
  error.type = details && details.type;
  error.requestID = response.headers.get('x-request-id')
    || (payload && (payload.request_id || payload.id));
  return error;
}

async function imageProviderFetch(pathname, options) {
  const response = await imageHttp().fetch(imageEndpoint(pathname), options);
  if (!response.ok) throw await imageProviderError(response);
  return response;
}

async function downloadProviderImage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (error) {
    const invalid = new Error('Image provider returned an invalid image URL');
    invalid.code = 'provider_image_url_invalid';
    throw invalid;
  }
  if (parsed.protocol !== 'https:') {
    const insecure = new Error('Image provider returned an insecure image URL');
    insecure.code = 'provider_image_url_insecure';
    throw insecure;
  }
  const allowedHosts = imageDownloadHosts();
  if (allowedHosts.size && !allowedHosts.has(parsed.hostname.toLowerCase())) {
    const forbidden = new Error('Image provider returned an untrusted image host');
    forbidden.code = 'provider_image_host_forbidden';
    throw forbidden;
  }

  const response = await imageHttp().fetch(parsed.toString(), { method: 'GET' });
  if (!response.ok) {
    const failed = new Error('Generated image download failed');
    failed.status = response.status;
    failed.code = 'provider_image_download_failed';
    throw failed;
  }
  return Buffer.from(await response.arrayBuffer());
}

function buildImageRequestPayload(input, imageConfig = config.openai.image) {
  const payload = {
    model: imageConfig.model,
    prompt: input.prompt,
    n: 1,
    size: input.providerSize,
    quality: input.providerQuality || imageConfig.quality,
  };
  ['moderation', 'background', 'output_format'].forEach((key) => {
    if (imageConfig[key] !== undefined && imageConfig[key] !== null && imageConfig[key] !== '') {
      payload[key] = imageConfig[key];
    }
  });
  return payload;
}

async function createImage(input) {
  const imageConfig = config.openai.image;
  const common = buildImageRequestPayload(input, imageConfig);
  let response;

  if (input.referencePaths && input.referencePaths.length) {
    const form = new FormData();
    Object.entries(common).forEach(([key, value]) => {
      if (value !== undefined && value !== null) form.append(key, String(value));
    });
    const files = await Promise.all(input.referencePaths.map((filePath) => (
      fs.promises.readFile(filePath)
    )));
    files.forEach((file, index) => {
      form.append(
        'image[]',
        new Blob([file], { type: 'image/jpeg' }),
        `reference-${index + 1}.jpg`,
      );
    });
    response = await imageProviderFetch('/images/edits', {
      method: 'POST',
      headers: imageHeaders(input.idempotencyKey),
      body: form,
    });
  } else {
    response = await imageProviderFetch('/images/generations', {
      method: 'POST',
      headers: imageHeaders(input.idempotencyKey, true),
      body: JSON.stringify(common),
    });
  }
  const payload = await response.json();
  const usage = usageOf(payload);
  const item = payload.data && payload.data[0];
  if (!item || (!item.b64_json && !item.url)) throw new Error('Image provider did not return image data');

  return {
    id: response.headers.get('x-request-id') || payload.id || payload.request_id || null,
    model: payload.model || imageConfig.model,
    buffer: item.b64_json
      ? Buffer.from(item.b64_json, 'base64')
      : await downloadProviderImage(item.url),
    usage,
    costMicrosUsd: providerCostMicros(usage, true),
  };
}

module.exports = {
  buildImageRequestPayload,
  createImage,
};
