import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTextContent,
  buildTextInstructions,
} from './text_prompt_builder.js';

const baseEntries = (overrides = {}) => ({
  task_type: 'social_post',
  platform: 'xiaohongshu',
  goal: 'conversion',
  audience: '刚开始做自媒体的职场新人',
  tone: 'natural',
  structure: 'aida',
  length_mode: 'medium',
  target_length: null,
  input: '帮我写一条关于内容生成工具的种草文案',
  key_points: '节省时间；减少重复改稿；支持发布前整理素材',
  cta: 'comment',
  cta_text: '',
  forbidden_content: '不要承诺一夜涨粉',
  language: 'zh',
  ...overrides,
});

test('builds text instructions with platform rules and copywriting structure', () => {
  const instructions = buildTextInstructions(baseEntries());

  assert.match(instructions, /社交平台文案策划/);
  assert.match(instructions, /小红书/);
  assert.match(instructions, /AIDA/);
  assert.match(instructions, /注意力.*兴趣.*欲望.*行动/s);
  assert.match(instructions, /不要编造经历、数据、功效、评价/);
  assert.match(instructions, /只输出最终成品/);
});

test('builds text content with structure and user constraints in the brief', () => {
  const content = buildTextContent(baseEntries());

  assert.match(content, /创作简报：/);
  assert.match(content, /"structure": "aida"/);
  assert.match(content, /"forbidden_content": "不要承诺一夜涨粉"/);
  assert.match(content, /"audience": "刚开始做自媒体的职场新人"/);
});

test('uses English copywriting guidance when language is English', () => {
  const instructions = buildTextInstructions(baseEntries({
    language: 'en',
    platform: 'douyin',
    structure: 'pas',
    cta: 'purchase',
  }));

  assert.match(instructions, /social copy strategist/i);
  assert.match(instructions, /PAS/);
  assert.match(instructions, /problem.*agitate.*solution/i);
  assert.match(instructions, /Return only the finished content/i);
});
