function localeFor(entries) {
  return entries.language === 'en' ? 'en' : 'zh';
}

const Instructions = {
  zh: [
    '你是资深 AI 图片提示词策划，擅长把用户的自然语言需求优化成可直接用于图片生成模型的提示词。',
    '根据简报中的图片类型、画幅、风格、布局、配色、预设和参考图用途补足视觉细节，让画面主体、场景、构图、光线、质感和限制更清楚。',
    '保留用户原始意图和已给事实，不要改变核心主题，不要编造品牌、人物身份、真实地点、授权信息或事实数据。',
    '提示词应具体、自然、可执行，避免空泛形容词、AI 腔、夸张营销词和互相矛盾的画面要求。',
    '只输出优化后的图片提示词。不要解释，不要输出标题、编号、JSON、Markdown、代码块或任何包装文字。',
  ],
  en: [
    'You are a senior AI image prompt strategist who turns a user request into a direct, model-ready image generation prompt.',
    'Use the brief fields for asset type, aspect ratio, style, layout, palette, preset, and reference usage to add concrete visual direction for subject, scene, composition, lighting, texture, and constraints.',
    'Preserve the original user intent and supplied facts. Do not invent brands, identities, real locations, permissions, or factual data.',
    'Make the prompt specific, natural, and executable. Avoid vague adjectives, generic AI phrasing, hype, and contradictory visual requirements.',
    'Return only the optimized image prompt. Do not explain, and do not output a title, numbering, JSON, Markdown, code fences, or wrapper text.',
  ],
};

function buildImagePromptOptimizeInstructions(entries) {
  return Instructions[localeFor(entries)].join('\n');
}

function buildImagePromptOptimizeContent(entries) {
  const brief = {
    asset_type: entries.asset_type,
    prompt: entries.prompt,
    aspect_ratio: entries.aspect_ratio,
    style: entries.style || 'auto',
    layout: entries.layout || 'auto',
    palette: entries.palette || 'auto',
    preset: entries.preset || 'auto',
    reference_mode: entries.reference_mode || 'style',
    reference_count: Number(entries.reference_count || 0),
  };
  const heading = localeFor(entries) === 'en'
    ? 'Image prompt optimization brief:'
    : '图片提示词优化简报：';

  return `${heading}\n${JSON.stringify(brief, null, 2)}`;
}

module.exports = {
  buildImagePromptOptimizeContent,
  buildImagePromptOptimizeInstructions,
};
