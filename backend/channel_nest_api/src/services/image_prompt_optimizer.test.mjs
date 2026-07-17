import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildImagePromptOptimizeContent,
  buildImagePromptOptimizeInstructions,
} from './image_prompt_optimizer.js';

const baseEntries = (overrides = {}) => ({
  prompt: '生成一张古风性感妖娆古风美女正面图片',
  asset_type: 'general',
  style: 'chinese-vintage',
  layout: 'portrait',
  palette: 'emerald-gold',
  preset: 'auto',
  aspect_ratio: '3:4',
  reference_mode: 'style',
  reference_count: 1,
  language: 'zh',
  ...overrides,
});

test('builds Chinese image prompt optimization instructions for direct image generation prompts', () => {
  const instructions = buildImagePromptOptimizeInstructions(baseEntries());

  assert.match(instructions, /资深 AI 图片提示词策划/);
  assert.match(instructions, /只输出优化后的图片提示词/);
  assert.match(instructions, /不要解释/);
  assert.match(instructions, /不要编造品牌、人物身份、真实地点、授权信息或事实数据/);
});

test('builds image prompt optimization brief with selected visual controls', () => {
  const content = buildImagePromptOptimizeContent(baseEntries());

  assert.match(content, /图片提示词优化简报：/);
  assert.match(content, /"asset_type": "general"/);
  assert.match(content, /"style": "chinese-vintage"/);
  assert.match(content, /"layout": "portrait"/);
  assert.match(content, /"palette": "emerald-gold"/);
  assert.match(content, /"reference_count": 1/);
});

test('uses English optimization instructions when requested', () => {
  const instructions = buildImagePromptOptimizeInstructions(baseEntries({ language: 'en' }));

  assert.match(instructions, /senior AI image prompt strategist/i);
  assert.match(instructions, /Return only the optimized image prompt/i);
  assert.match(instructions, /Do not invent brands, identities, real locations, permissions, or factual data/i);
});
