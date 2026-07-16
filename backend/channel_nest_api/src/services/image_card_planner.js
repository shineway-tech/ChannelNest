const { buildStructuredJsonInput, parseStructuredJson } = require('./structured_json');
const { prompts, resolveVisualChoices } = require('./image_prompt_catalog');

const CardPlanSchema = {
  type: 'object',
  required: ['cards'],
  additionalProperties: false,
  properties: {
    cards: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['position', 'core_message', 'text_items', 'visual_concept'],
        additionalProperties: false,
        properties: {
          position: { type: 'string' },
          core_message: { type: 'string' },
          text_items: { type: 'array', items: { type: 'string' } },
          visual_concept: { type: 'string' },
        },
      },
    },
  },
};

function fallbackPosition(index, count) {
  if (index === 0) return 'cover';
  if (index === count - 1) return 'summary';
  if (count === 3) return 'detail';
  return `detail-${index}`;
}

function fallbackCardPlans(input) {
  return Array.from({ length: input.count }, (_, index) => ({
    position: fallbackPosition(index, input.count),
    core_message: index === 0
      ? 'Introduce the main topic with a clear hook.'
      : index === input.count - 1
        ? 'Summarize the key takeaway and make the card feel complete.'
        : 'Explain one important supporting point from the source.',
    text_items: index === 0
      ? ['Clear title', 'One-sentence hook']
      : index === input.count - 1
        ? ['Key takeaway', 'Simple next step']
        : ['Supporting point', 'Short explanation'],
    visual_concept: index === 0
      ? 'Strong cover composition with one focal visual.'
      : index === input.count - 1
        ? 'Clean ending card with a memorable summary visual.'
        : 'Structured detail card with icons, arrows, or grouped sections.',
  }));
}

function normalizeTextItems(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);
}

function normalizePlans(value, input) {
  const fallback = fallbackCardPlans(input);
  const cards = Array.isArray(value && value.cards) ? value.cards : [];

  return fallback.map((item, index) => {
    const card = cards[index] || {};
    return {
      position: String(card.position || item.position).trim(),
      core_message: String(card.core_message || item.core_message).trim(),
      text_items: normalizeTextItems(card.text_items).length
        ? normalizeTextItems(card.text_items)
        : item.text_items,
      visual_concept: String(card.visual_concept || item.visual_concept).trim(),
    };
  });
}

function plannerContent(input) {
  const visual = resolveVisualChoices(input);
  return [
    `Card count: ${input.count}`,
    `Output language: ${input.language || 'auto'}`,
    `Asset type: ${input.assetType}`,
    `Style: ${visual.style}`,
    `Layout: ${visual.layout}`,
    `Palette: ${visual.palette}`,
    `Preset: ${visual.preset}`,
    input.seriesStrategy ? `Series strategy: ${input.seriesStrategy}` : '',
    input.cardNotes ? `User card notes: ${input.cardNotes}` : '',
    '',
    'Source content:',
    input.userContent,
  ].filter(Boolean).join('\n');
}

async function planImageCards(input) {
  if (input.assetType !== 'xhs_card' || Number(input.count) <= 1) return null;
  if (!input.createText) return fallbackCardPlans(input);

  const response = await input.createText({
    userId: input.userId,
    instructions: prompts.socialPlanner,
    content: buildStructuredJsonInput(plannerContent(input), {
      ...CardPlanSchema,
      properties: {
        ...CardPlanSchema.properties,
        cards: {
          ...CardPlanSchema.properties.cards,
          minItems: input.count,
          maxItems: input.count,
        },
      },
    }),
  });

  return normalizePlans(parseStructuredJson(response.text), input);
}

module.exports = {
  fallbackCardPlans,
  planImageCards,
  plannerContent,
};
