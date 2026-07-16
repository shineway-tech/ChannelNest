const Router = require('koa-router');
const controller = require('./auth');
const {
  checkLogin,
  checkRegister,
  checkEmailCode,
  checkBindEmail,
  checkResetPassword,
  checkUpdatePassword,
  checkUpdateProfile,
} = require('./filter');
const checkAuth = require('../../../middlewares/check_auth');

const router = new Router();

router.get('/captcha', controller.captcha);
router.post('/email-codes', checkEmailCode, controller.emailCode);
router.post('/register', checkRegister, controller.register);
router.post('/login', checkLogin, controller.login);
router.post('/logout', checkAuth(), controller.logout);
router.post('/email/bind', checkAuth(), checkBindEmail, controller.bindEmail);
router.post('/password/reset-codes', checkEmailCode, async (ctx, next) => {
  ctx.state.entries.scene = 'reset_password';
  await controller.emailCode(ctx, next);
});
router.post('/password/reset', checkResetPassword, controller.resetPassword);
router.get('/me', checkAuth(), controller.me);
router.put('/profile', checkAuth(), checkUpdateProfile, controller.updateProfile);
router.put('/password', checkAuth(), checkUpdatePassword, controller.updatePassword);

module.exports = router;
