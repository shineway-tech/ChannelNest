const { validateBody } = require('@honeykid/ml');
const Joi = require('joi');

const requestId = Joi.string().guid({ version: 'uuidv4' }).required();

const checkCreateOrder = validateBody(Joi.object({
  order_type: Joi.string().valid('membership', 'recharge').required(),
  product_code: Joi.string().max(64).required(),
  client_request_id: requestId,
}), { stripUnknown: true });

const checkPayment = validateBody(Joi.object({
  client_request_id: requestId,
}), { stripUnknown: true });

const checkUpgradeQuote = validateBody(Joi.object({
  product_code: Joi.string().valid('basic', 'advanced', 'professional').required(),
}), { stripUnknown: true });

module.exports = { checkCreateOrder, checkPayment, checkUpgradeQuote };
