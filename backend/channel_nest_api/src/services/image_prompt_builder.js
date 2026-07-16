const { Catalog, prompts, resolveVisualChoices } = require('./image_prompt_catalog');
const {
  buildInfographicAssetPrompt,
  buildXhsAssetPrompt,
} = require('./image_prompt_assets');

function basePrompt(assetType) {
  if (assetType === 'xhs_card') return prompts.xhsCard;
  if (assetType === 'infographic') return prompts.infographic;
  return prompts.general;
}

function referenceGuidance(mode, count) {
  if (!count) return null;
  if (mode === 'identity') {
    return [
      'Reference image mode: identity preservation.',
      'Use the person, object, or product in the reference image(s) as the same identity.',
      'Do not redesign it or create a similar-looking new subject.',
      'Only change scene, lighting, composition, pose, rendering style, and surrounding visual treatment when requested.',
    ].join(' ');
  }
  if (mode === 'palette') {
    return [
      'Reference image mode: color palette.',
      'Use the reference image color palette, contrast, and mood as inspiration only.',
      'Do not copy the reference composition, subject identity, logos, or private details.',
    ].join(' ');
  }
  return [
    'Reference image mode: visual style.',
    'Use the reference image style, texture, lighting, and composition mood as inspiration.',
    'Do not preserve subject identity unless the user explicitly asks for it.',
  ].join(' ');
}

function buildImagePrompt(input) {
  const visual = resolveVisualChoices(input);
  const parts = [
    prompts.safety,
    basePrompt(input.assetType),
    `Output: ${input.outputWidth}x${input.outputHeight}, aspect ratio ${input.aspectRatio}.`,
  ];

  if (input.assetType === 'xhs_card') {
    parts.push(`Visual system: style=${visual.style}, layout=${visual.layout}, palette=${visual.palette}, preset=${visual.preset}.`);
    parts.push(buildXhsAssetPrompt({
      style: visual.style,
      layout: visual.layout,
      palette: visual.palette,
    }));
    if (visual.presetProfile && visual.presetProfile.guidance) {
      parts.push(`Preset guidance: ${visual.presetProfile.guidance}`);
    }
    if (Catalog.styleProfiles[visual.style]) {
      parts.push(`Style guidance: ${Catalog.styleProfiles[visual.style]}`);
    }
    if (Catalog.layoutProfiles[visual.layout]) {
      parts.push(`Layout guidance: ${Catalog.layoutProfiles[visual.layout]}`);
    }
  } else if (input.assetType === 'infographic') {
    parts.push(`Infographic system: layout=${visual.layout}, style=${visual.style}, palette=${visual.palette}.`);
    parts.push(buildInfographicAssetPrompt({
      style: visual.style,
      layout: visual.layout,
      palette: visual.palette,
      aspectRatio: input.aspectRatio,
      language: input.language,
      userContent: input.userContent,
    }));
    if (Catalog.infographicLayoutProfiles[visual.layout]) {
      parts.push(`Infographic layout guidance: ${Catalog.infographicLayoutProfiles[visual.layout]}`);
    }
    if (Catalog.infographicStyleProfiles[visual.style]) {
      parts.push(`Infographic style guidance: ${Catalog.infographicStyleProfiles[visual.style]}`);
    }
    parts.push('Infographic content rules: preserve factual meaning, group related ideas, keep labels short, prefer visual hierarchy over long paragraphs, and make the final image understandable at social-feed size.');
  }
  const paletteProfile = Catalog.paletteGuidance[visual.palette] || Catalog.paletteProfiles[visual.palette];
  if (paletteProfile) parts.push(`Color direction: ${paletteProfile}`);
  const reference = referenceGuidance(input.referenceMode || 'style', input.referenceCount || 0);
  if (reference) parts.push(reference);
  if (input.cardPlan) {
    parts.push(`Series card ${input.sequenceNo} of ${input.count}. Purpose: ${input.cardPlan.position}. Core message: ${input.cardPlan.core_message}. Text: ${(input.cardPlan.text_items || []).join(' / ')}. Visual concept: ${input.cardPlan.visual_concept}.`);
  } else if (input.count > 1) {
    parts.push(`Variant ${input.sequenceNo} of ${input.count}; maintain the requested subject while varying composition.`);
  }
  if (input.watermark && input.watermark.enabled && input.watermark.content) {
    parts.push(`Include a subtle watermark "${input.watermark.content}" at ${input.watermark.position}.`);
  }
  parts.push(`Image text language: ${input.language || 'auto'}. Produce exactly one image.`);
  parts.push(`USER CONTENT START\n${input.userContent}\nUSER CONTENT END`);

  return parts.join('\n\n');
}

module.exports = { buildImagePrompt };
