const Router = require('koa-router');
const { validateBody } = require('@honeykid/ml');
const Joi = require('joi');
const controller = require('./entitlements');
const requireRegisteredUser = require('../../../middlewares/require_registered_user');

const router = new Router();

router.get('/', requireRegisteredUser(), controller.index);
router.post('/check', requireRegisteredUser(), validateBody(Joi.object({
  capability_code: Joi.string().max(64).required(),
}), { stripUnknown: true }), controller.check);

module.exports = router;
