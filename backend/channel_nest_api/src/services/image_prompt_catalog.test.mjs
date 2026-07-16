import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { Catalog } = require('./image_prompt_catalog.js');

test('exposes infographic as its own image asset type with scoped controls', () => {
  const infographic = Catalog.assetTypes.find((item) => item.code === 'infographic');

  assert.ok(infographic);
  assert.equal(infographic.defaultAspectRatio, '9:16');
  assert.ok(infographic.styleCodes.includes('technical-schematic'));
  assert.ok(infographic.layoutCodes.includes('bento-grid'));
  assert.ok(infographic.layoutCodes.includes('funnel'));
  assert.deepEqual(infographic.presetCodes, ['auto']);
});

test('keeps social card and infographic option codes in separate scopes', () => {
  const social = Catalog.assetTypes.find((item) => item.code === 'xhs_card');
  const infographic = Catalog.assetTypes.find((item) => item.code === 'infographic');

  assert.ok(social.styleCodes.includes('cute'));
  assert.equal(social.styleCodes.includes('technical-schematic'), false);
  assert.ok(infographic.styleCodes.includes('technical-schematic'));
  assert.equal(infographic.styleCodes.includes('cute'), false);
});
