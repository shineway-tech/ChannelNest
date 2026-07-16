const { validateBody } = require('@honeykid/ml');
const Joi = require('joi');
const { Catalog } = require('../../../services/image_prompt_catalog');

const requestId = Joi.string().guid({ version: 'uuidv4' }).required();

const checkText = validateBody(Joi.object({
  client_request_id: requestId,
  task_type: Joi.string().valid(
    'social_post',
    'video_script',
    'social_title',
    'rewrite',
  ).required(),
  platform: Joi.string().valid('general', 'xiaohongshu', 'douyin', 'kuaishou', 'bilibili', 'wechat').default('general'),
  goal: Joi.string().valid('auto', 'awareness', 'engagement', 'conversion', 'education').default('auto'),
  audience: Joi.string().trim().allow('').max(200)
    .default(''),
  tone: Joi.string().valid('auto', 'natural', 'professional', 'friendly', 'humorous').default('auto'),
  structure: Joi.string().valid('auto', 'aida', 'pas', 'fab', 'story', 'list').default('auto'),
  length_mode: Joi.string().valid('auto', 'short', 'medium', 'long', 'custom').default('auto'),
  target_length: Joi.number().integer().min(50).max(2000)
    .allow(null)
    .default(null),
  input: Joi.string().trim().min(1).max(2000)
    .required(),
  key_points: Joi.string().trim().allow('').max(600)
    .default(''),
  cta: Joi.string().valid('auto', 'none', 'comment', 'purchase', 'custom').default('auto'),
  cta_text: Joi.string().trim().allow('').max(120)
    .default(''),
  forbidden_content: Joi.string().trim().allow('').max(300)
    .default(''),
  language: Joi.string().valid('zh', 'en', 'ja').default('zh'),
}).custom((value, helpers) => {
  if (value.length_mode === 'custom' && !value.target_length) {
    return helpers.error('any.custom', { message: 'target_length is required for custom length' });
  }
  if (value.cta === 'custom' && !value.cta_text) {
    return helpers.error('any.custom', { message: 'cta_text is required for custom CTA' });
  }
  return value;
}), { stripUnknown: true });

const checkImages = validateBody(Joi.object({
  client_request_id: requestId,
  asset_type: Joi.string().valid('general', 'xhs_card', 'infographic').required(),
  prompt: Joi.string().trim().min(1).max(2000)
    .required(),
  resolution: Joi.string().valid('1k', '2k', '4k').required(),
  aspect_ratio: Joi.string().valid(...Catalog.aspectRatios).required(),
  count: Joi.number().integer().min(1).max(4)
    .required(),
  language: Joi.string().valid('auto', 'zh', 'en', 'ja').default('auto'),
  reference_ids: Joi.array().items(Joi.string().guid({ version: 'uuidv4' })).unique().max(4)
    .default([]),
  reference_mode: Joi.string().valid('identity', 'style', 'palette').default('style'),
  preset: Joi.string().valid(...Catalog.presets).default('auto'),
  style: Joi.string().valid(...Catalog.styles).default('auto'),
  layout: Joi.string().valid(...Catalog.layouts).default('auto'),
  palette: Joi.string().valid(...Catalog.palettes).default('auto'),
  series_strategy: Joi.string().valid('auto', 'cover-detail-summary', 'parallel').default('auto'),
  card_notes: Joi.string().allow('').max(500).default(''),
  watermark: Joi.object({
    enabled: Joi.boolean().required(),
    content: Joi.string().allow('').max(32).required(),
    position: Joi.string().valid('top-left', 'top-right', 'bottom-left', 'bottom-right').required(),
  }).default({ enabled: false, content: '', position: 'bottom-right' }),
}), { stripUnknown: true });

module.exports = { checkImages, checkText };
