function buildStructuredJsonInput(content, schema) {
  return [
    String(content || '').trim(),
    '',
    'OUTPUT JSON CONTRACT',
    'Return exactly one JSON object matching the schema below.',
    'Do not add Markdown fences, explanations, or properties outside the schema.',
    JSON.stringify(schema),
  ].join('\n');
}

function parseStructuredJson(value) {
  let source = String(value || '').trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
  if (fenced) source = fenced[1].trim();

  try {
    return JSON.parse(source);
  } catch (error) {
    const start = source.indexOf('{');
    const end = source.lastIndexOf('}');
    if (start < 0 || end <= start) throw error;
    return JSON.parse(source.slice(start, end + 1));
  }
}

module.exports = { buildStructuredJsonInput, parseStructuredJson };
