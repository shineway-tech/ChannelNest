import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { buildImagePrompt } = require('./image_prompt_builder.js');

function baseInput(overrides = {}) {
  return {
    assetType: 'xhs_card',
    userContent: '用三张图解释如何坚持运动',
    style: 'notion',
    layout: 'dense',
    palette: 'macaron',
    preset: 'knowledge-card',
    aspectRatio: '3:4',
    outputWidth: 1536,
    outputHeight: 2048,
    language: 'zh',
    sequenceNo: 1,
    count: 3,
    ...overrides,
  };
}

test('expands baoyu xhs style, layout, palette, and preset instructions', () => {
  const prompt = buildImagePrompt(baseInput());

  assert.match(prompt, /minimalist hand-drawn line art/i);
  assert.match(prompt, /5-8 points/i);
  assert.match(prompt, /knowledge card/i);
  assert.match(prompt, /Warm cream #F5F0E8/i);
});

test('adds reference mode guidance without forcing every reference to preserve identity', () => {
  const identityPrompt = buildImagePrompt(baseInput({
    referenceMode: 'identity',
    referenceCount: 2,
  }));
  const palettePrompt = buildImagePrompt(baseInput({
    referenceMode: 'palette',
    referenceCount: 1,
  }));

  assert.match(identityPrompt, /same identity/i);
  assert.match(identityPrompt, /Do not redesign/i);
  assert.match(palettePrompt, /color palette/i);
  assert.doesNotMatch(palettePrompt, /same identity/i);
});

test('builds baoyu infographic prompts with infographic layout and style guidance', () => {
  const prompt = buildImagePrompt(baseInput({
    assetType: 'infographic',
    style: 'technical-schematic',
    layout: 'funnel',
    palette: 'default',
    preset: 'auto',
    aspectRatio: '9:16',
    outputWidth: 1152,
    outputHeight: 2048,
    count: 1,
  }));

  assert.match(prompt, /professional infographic/i);
  assert.match(prompt, /funnel/i);
  assert.match(prompt, /conversion|filtering/i);
  assert.match(prompt, /blueprint|engineering/i);
});

test('uses original baoyu infographic prompt assets for selected layout and style', () => {
  const prompt = buildImagePrompt(baseInput({
    assetType: 'infographic',
    style: 'technical-schematic',
    layout: 'funnel',
    palette: 'default',
    preset: 'auto',
    aspectRatio: '9:16',
    outputWidth: 1152,
    outputHeight: 2048,
    count: 1,
  }));

  assert.match(prompt, /Create a professional infographic following these specifications:/);
  assert.match(prompt, /Wide top \(input\/start\)/);
  assert.match(prompt, /Geometric precision throughout/);
});

test('uses original baoyu xhs prompt assets for selected style, layout, and palette', () => {
  const prompt = buildImagePrompt(baseInput({
    style: 'notion',
    layout: 'dense',
    palette: 'macaron',
    preset: 'auto',
  }));

  assert.match(prompt, /Create a Xiaohongshu \(Little Red Book\) style infographic/);
  assert.match(prompt, /Core canvas specifications and layout grids for Xiaohongshu infographics/);
  assert.match(prompt, /Minimalist hand-drawn line art, intellectual aesthetic/);
  assert.match(prompt, /Palette Override/);
});
