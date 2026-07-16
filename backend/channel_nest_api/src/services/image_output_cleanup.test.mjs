import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { ackImageOutputFile } = require('./image_output_cleanup.js');

test('acknowledges one generated image output by deleting its temp file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'market-tool-output-'));
  const relativePath = path.join('outputs', 'user-1', 'request-1', '1.jpg');
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, 'image');
  let updatePayload = null;
  const output = {
    relative_path: relativePath,
    update: async (payload) => {
      updatePayload = payload;
    },
  };

  await ackImageOutputFile(output, root);

  await assert.rejects(fs.stat(filePath), /ENOENT/);
  assert.equal(updatePayload.status, 'downloaded');
  assert.equal(updatePayload.relative_path, '');
  assert.ok(updatePayload.downloaded_at instanceof Date);
  assert.ok(updatePayload.deleted_at instanceof Date);
});

test('does not delete files outside the temp storage root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'market-tool-output-'));
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'market-tool-outside-'));
  const outsideFile = path.join(outside, 'image.jpg');
  await fs.writeFile(outsideFile, 'image');
  let updated = false;

  await ackImageOutputFile({
    relative_path: path.relative(root, outsideFile),
    update: async () => {
      updated = true;
    },
  }, root);

  assert.equal(await fs.readFile(outsideFile, 'utf8'), 'image');
  assert.equal(updated, true);
});
