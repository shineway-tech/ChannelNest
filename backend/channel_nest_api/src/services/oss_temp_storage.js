const crypto = require('crypto');
const http = require('http');
const https = require('https');
const config = require('../../config');

function ossConfig() {
  return config.ai_temp_storage && config.ai_temp_storage.oss
    ? config.ai_temp_storage.oss
    : {};
}

function enabled() {
  const oss = ossConfig();
  return Boolean(
    oss.enabled
      && oss.region
      && oss.bucket
      && oss.access_key_id
      && oss.access_key_secret,
  );
}

function normalizePrefix(prefix) {
  return String(prefix || 'tmp/channel-nest/ai-images')
    .replace(/^\/+|\/+$/g, '')
    .replace(/\/+/g, '/');
}

function normalizeEndpoint(endpoint) {
  return String(endpoint || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/+$/g, '');
}

function endpointHost(internal = false) {
  const oss = ossConfig();
  const configured = internal ? oss.internal_endpoint : oss.public_endpoint;
  if (configured) return normalizeEndpoint(configured);
  const suffix = internal ? `${oss.region}-internal.aliyuncs.com` : `${oss.region}.aliyuncs.com`;
  return `${oss.bucket}.${suffix}`;
}

function sign({ method, contentType = '', date = '', expires = '', objectKey, ossHeaders = {} }) {
  const oss = ossConfig();
  const canonicalizedOssHeaders = Object.entries(ossHeaders)
    .map(([key, value]) => [key.toLowerCase(), String(value).trim()])
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}:${value}\n`)
    .join('');
  const canonicalizedResource = `/${oss.bucket}/${objectKey}`;
  const stringToSign = [
    method,
    '',
    contentType,
    expires || date,
    `${canonicalizedOssHeaders}${canonicalizedResource}`,
  ].join('\n');
  return crypto
    .createHmac('sha1', oss.access_key_secret)
    .update(stringToSign)
    .digest('base64');
}

function objectKey({ userId, requestId, outputId }) {
  const prefix = normalizePrefix(ossConfig().prefix);
  return `${prefix}/${userId}/${requestId}/${outputId}.jpg`;
}

function storedPath(objectKeyValue) {
  return `oss:${objectKeyValue}`;
}

function parseStoredPath(value) {
  const text = String(value || '');
  return text.startsWith('oss:') ? text.slice(4) : null;
}

function requestBuffer(url, { method, headers, buffer }) {
  const parsed = new URL(url);
  const client = parsed.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const request = client.request(parsed, { method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve();
          return;
        }
        reject(new Error(`OSS ${method} failed: ${response.statusCode} ${Buffer.concat(chunks).toString('utf8')}`));
      });
    });
    request.on('error', reject);
    if (buffer) request.end(buffer);
    else request.end();
  });
}

async function putObject(objectKeyValue, buffer, contentType = 'image/jpeg') {
  const date = new Date().toUTCString();
  const ossHeaders = {};
  const headers = {
    Date: date,
    'Content-Type': contentType,
    'Content-Length': buffer.length,
    Authorization: `OSS ${ossConfig().access_key_id}:${sign({
      method: 'PUT',
      contentType,
      date,
      objectKey: objectKeyValue,
      ossHeaders,
    })}`,
    ...ossHeaders,
  };
  await requestBuffer(`https://${endpointHost(true)}/${objectKeyValue}`, {
    method: 'PUT',
    headers,
    buffer,
  });
}

async function deleteObject(objectKeyValue) {
  const date = new Date().toUTCString();
  const contentType = '';
  const headers = {
    Date: date,
    Authorization: `OSS ${ossConfig().access_key_id}:${sign({
      method: 'DELETE',
      contentType,
      date,
      objectKey: objectKeyValue,
    })}`,
  };
  await requestBuffer(`https://${endpointHost(true)}/${objectKeyValue}`, {
    method: 'DELETE',
    headers,
  });
}

function signedUrl(objectKeyValue, ttlSeconds = ossConfig().signed_url_ttl_seconds || 900) {
  const expires = Math.floor(Date.now() / 1000) + Number(ttlSeconds || 900);
  const signature = sign({
    method: 'GET',
    expires: String(expires),
    objectKey: objectKeyValue,
  });
  const url = new URL(`https://${endpointHost(false)}/${objectKeyValue}`);
  url.searchParams.set('OSSAccessKeyId', ossConfig().access_key_id);
  url.searchParams.set('Expires', String(expires));
  url.searchParams.set('Signature', signature);
  return url.toString();
}

module.exports = {
  deleteObject,
  enabled,
  objectKey,
  parseStoredPath,
  putObject,
  signedUrl,
  storedPath,
};
