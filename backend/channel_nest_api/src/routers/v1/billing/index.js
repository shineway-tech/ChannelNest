const Router = require('koa-router');
const controller = require('./billing');
const { checkCreateOrder, checkPayment, checkUpgradeQuote } = require('./filter');
const requireRegisteredUser = require('../../../middlewares/require_registered_user');
const requireEntitlement = require('../../../middlewares/require_entitlement');

const router = new Router();
const view = [requireRegisteredUser(), requireEntitlement('billing.view')];
const purchase = [requireRegisteredUser({ requireEmail: true }), requireEntitlement('billing.purchase')];

router.post('/payment-callbacks/:provider', controller.callback);
router.get('/overview', ...view, controller.overview);
router.get('/ledgers', ...view, controller.ledgers);
router.post('/membership/upgrade-quote', ...purchase, checkUpgradeQuote, controller.upgradeQuote);
router.post('/orders', ...purchase, checkCreateOrder, controller.createOrder);
router.get('/orders', ...view, controller.orders);
router.get('/orders/:order_id', ...view, controller.order);
router.post('/orders/:order_id/payment', ...purchase, checkPayment, controller.payment);
router.post('/orders/:order_id/close', ...purchase, controller.close);

module.exports = router;
