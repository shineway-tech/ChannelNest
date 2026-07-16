const Router = require('koa-router');
const auth = require('./auth');
const ai = require('./ai');
const billing = require('./billing');
const channel = require('./channel');
const feedback = require('./feedback');
const desktopUpdate = require('./desktop_update');
const entitlements = require('./entitlements');
const messages = require('./messages');

const router = new Router();

router.use('/auth', auth.routes(), auth.allowedMethods());
router.use('/ai', ai.routes(), ai.allowedMethods());
router.use('/billing', billing.routes(), billing.allowedMethods());
router.use('/channel', channel.routes(), channel.allowedMethods());
router.use('/feedback', feedback.routes(), feedback.allowedMethods());
router.use('/desktop-updates', desktopUpdate.routes(), desktopUpdate.allowedMethods());
router.use('/entitlements', entitlements.routes(), entitlements.allowedMethods());
router.use('/messages', messages.routes(), messages.allowedMethods());

module.exports = router;
