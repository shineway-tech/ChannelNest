const Router = require('koa-router');
const checkSign = require('@honeykid/ml/middlewares/check_sign');
const config = require('../../config');
const setAuthUser = require('../middlewares/set_auth_user');
const v1 = require('./v1');

const router = new Router();
const signWhiteList = [
  /^\/health$/,
  /^\/v1\/auth/,
  /^\/v1\/channel/,
  /^\/v1\/feedback/,
  /^\/v1\/desktop-updates/,
  /^\/v1\/billing/,
  /^\/v1\/entitlements/,
  /^\/v1\/messages/,
  /^\/v1\/ai/,
];

router.use(checkSign(config.sign_token, signWhiteList));
router.use(setAuthUser());
router.get('/health', async (ctx) => {
  ctx.setData({
    service: 'channel_nest_api',
    env: config.env,
  });
});
router.use('/v1', v1.routes(), v1.allowedMethods());

module.exports = router;
