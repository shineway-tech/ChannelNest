import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { withImageRetries } = require('./image_retry.js');

test('retries retryable image operations and reports provider attempts', async () => {
  let attempts = 0;
  const result = await withImageRetries(async () => {
    attempts += 1;
    if (attempts === 1) {
      const error = new Error('rate limited');
      error.status = 429;
      throw error;
    }
    return { id: 'image-call-1' };
  }, {
    maxRetries: 1,
    wait: async () => {},
    classifyError: () => ({ retryable: true }),
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result, { id: 'image-call-1', attempts: 2 });
});

test('does not retry non-retryable image operations', async () => {
  let attempts = 0;

  await assert.rejects(withImageRetries(async () => {
    attempts += 1;
    const error = new Error('bad request');
    error.status = 400;
    throw error;
  }, {
    maxRetries: 3,
    wait: async () => {},
    classifyError: () => ({ retryable: false }),
  }), /bad request/);

  assert.equal(attempts, 1);
});
