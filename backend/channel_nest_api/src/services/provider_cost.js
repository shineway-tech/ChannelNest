const config = require('../../config');

function usageOf(response) {
  const usage = response.usage || {};
  return {
    inputTokens: usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? null,
    cachedInputTokens: usage.input_tokens_details?.cached_tokens
      ?? usage.inputTokensDetails?.cachedTokens
      ?? usage.prompt_tokens_details?.cached_tokens ?? null,
    outputTokens: usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? null,
    totalTokens: usage.total_tokens ?? usage.totalTokens ?? null,
  };
}

function providerCostMicros(usage, image = false) {
  if (!image && config.openai.text.provider !== 'openai') return 0;
  const { pricing } = config.openai;
  const inputRate = image ? pricing.image_text_input_usd_per_million_tokens
    : pricing.text_input_usd_per_million_tokens;
  const cachedRate = image ? pricing.image_cached_input_usd_per_million_tokens
    : pricing.text_cached_input_usd_per_million_tokens;
  const outputRate = image ? pricing.image_output_usd_per_million_tokens
    : pricing.text_output_usd_per_million_tokens;
  const input = Number(usage.inputTokens || 0);
  const cached = Math.min(input, Number(usage.cachedInputTokens || 0));
  const output = Number(usage.outputTokens || 0);

  return Math.round((input - cached) * inputRate + cached * cachedRate + output * outputRate);
}

module.exports = {
  providerCostMicros,
  usageOf,
};
