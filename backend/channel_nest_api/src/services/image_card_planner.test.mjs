import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { planImageCards } = require('./image_card_planner.js');

test('plans a multi-card social image series with structured JSON', async () => {
  let captured;
  const plans = await planImageCards({
    userId: 'user-1',
    count: 3,
    assetType: 'xhs_card',
    userContent: '如何提高睡眠质量',
    style: 'notion',
    layout: 'flow',
    palette: 'macaron',
    preset: 'tutorial',
    language: 'zh',
    createText: async (input) => {
      captured = input;
      return {
        text: JSON.stringify({
          cards: [
            {
              position: 'cover',
              core_message: '睡得好从睡前节奏开始',
              text_items: ['睡前 3 步'],
              visual_concept: '月亮、床头灯、三段节奏',
            },
            {
              position: 'detail',
              core_message: '减少刺激源',
              text_items: ['少咖啡', '少蓝光', '放松呼吸'],
              visual_concept: '三个小图标横向流程',
            },
            {
              position: 'summary',
              core_message: '固定习惯更重要',
              text_items: ['每天同一时间', '坚持一周看变化'],
              visual_concept: '日历打勾和柔和渐变',
            },
          ],
        }),
      };
    },
  });

  assert.equal(plans.length, 3);
  assert.equal(plans[0].position, 'cover');
  assert.deepEqual(plans[1].text_items, ['少咖啡', '少蓝光', '放松呼吸']);
  assert.match(captured.instructions, /social image series/i);
  assert.match(captured.content, /OUTPUT JSON CONTRACT/);
  assert.match(captured.content, /notion/);
});

test('skips planning for single images and non-social image types', async () => {
  const createText = async () => {
    throw new Error('planner should not be called');
  };

  assert.equal(await planImageCards({
    userId: 'user-1',
    count: 1,
    assetType: 'xhs_card',
    userContent: '单张图',
    createText,
  }), null);
  assert.equal(await planImageCards({
    userId: 'user-1',
    count: 3,
    assetType: 'general',
    userContent: '通用图片',
    createText,
  }), null);
});
