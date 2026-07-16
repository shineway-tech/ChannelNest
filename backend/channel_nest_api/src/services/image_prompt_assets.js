const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../../prompts/image');

function assetPath(...segments) {
  return path.join(root, ...segments);
}

function readAsset(...segments) {
  try {
    return fs.readFileSync(assetPath(...segments), 'utf8').trim();
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function stripFrontmatter(markdown) {
  return String(markdown || '').replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
}

function section(title, content) {
  const body = String(content || '').trim();
  return body ? `## ${title}\n\n${body}` : '';
}

function buildInfographicAssetPrompt(input) {
  const base = readAsset('baoyu-infographic', 'base-prompt.md')
    .replaceAll('{{LAYOUT}}', input.layout)
    .replaceAll('{{STYLE}}', input.style)
    .replaceAll('{{ASPECT_RATIO}}', input.aspectRatio)
    .replaceAll('{{LANGUAGE}}', input.language || 'auto')
    .replaceAll('{{LAYOUT_GUIDELINES}}', readAsset('baoyu-infographic', 'layouts', `${input.layout}.md`))
    .replaceAll('{{STYLE_GUIDELINES}}', readAsset('baoyu-infographic', 'styles', `${input.style}.md`))
    .replaceAll('{{CONTENT}}', input.userContent)
    .replaceAll('{{TEXT_LABELS}}', input.textLabels || 'Use concise labels derived from the source content.');

  return [
    section('Baoyu Infographic Base Prompt', base),
    section('Baoyu Infographic Analysis Framework', readAsset('baoyu-infographic', 'analysis-framework.md')),
    section('Baoyu Infographic Structured Content Template', readAsset('baoyu-infographic', 'structured-content-template.md')),
  ].filter(Boolean).join('\n\n');
}

function buildXhsAssetPrompt(input) {
  const style = input.style === 'auto' ? '' : readAsset('baoyu-xhs-images', 'presets', `${input.style}.md`);
  const palette = ['macaron', 'warm', 'neon'].includes(input.palette)
    ? readAsset('baoyu-xhs-images', 'palettes', `${input.palette}.md`)
    : '';

  return [
    section('Baoyu XHS Prompt Assembly', readAsset('baoyu-xhs-images', 'workflows', 'prompt-assembly.md')),
    section('Baoyu XHS Canvas And Layout', readAsset('baoyu-xhs-images', 'elements', 'canvas.md')),
    section('Baoyu XHS Typography', readAsset('baoyu-xhs-images', 'elements', 'typography.md')),
    section('Baoyu XHS Decorations', readAsset('baoyu-xhs-images', 'elements', 'decorations.md')),
    section('Baoyu XHS Image Effects', readAsset('baoyu-xhs-images', 'elements', 'image-effects.md')),
    section(`Baoyu XHS Style Preset: ${input.style}`, stripFrontmatter(style)),
    section(`Baoyu XHS Palette: ${input.palette}`, stripFrontmatter(palette)),
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  buildInfographicAssetPrompt,
  buildXhsAssetPrompt,
  readAsset,
};
