import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildImageRequestPayload } = require('./openai.js');

test('builds OpenAI native image request payload with configured image options', () => {
  const payload = buildImageRequestPayload({
    prompt: 'A clean social card',
    providerSize: '1024x1360',
    providerQuality: 'medium',
  }, {
    model: 'gpt-image-2',
    quality: 'low',
    moderation: 'auto',
    background: 'opaque',
    output_format: 'jpeg',
  });

  assert.deepEqual(payload, {
    model: 'gpt-image-2',
    prompt: 'A clean social card',
    n: 1,
    size: '1024x1360',
    quality: 'medium',
    moderation: 'auto',
    background: 'opaque',
    output_format: 'jpeg',
  });
});
