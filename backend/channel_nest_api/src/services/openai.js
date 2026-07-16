const config = require('../../config');
const {
  imageTaskErrorCode,
  providerErrorDetails,
  providerErrorMessage,
} = require('./provider_errors');
const {
  createText,
  createTextStream,
} = require('./openai_text_provider');
const {
  buildImageRequestPayload,
  createImage,
} = require('./openai_image_provider');

module.exports = {
  buildImageRequestPayload,
  createImage,
  createText,
  createTextStream,
  isConfigured: () => Boolean(config.openai.text.api_key || config.openai.api_key),
  imageTaskErrorCode,
  providerErrorDetails,
  providerErrorMessage,
};
