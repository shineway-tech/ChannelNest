const Router = require('koa-router');
const controller = require('./messages');
const requireRegisteredUser = require('../../../middlewares/require_registered_user');
const requireEntitlement = require('../../../middlewares/require_entitlement');

const router = new Router();
const access = [requireRegisteredUser(), requireEntitlement('messages.view')];

router.get('/', ...access, controller.list);
router.get('/unread-count', ...access, controller.unreadCount);
router.post('/read-all', ...access, controller.readAll);
router.post('/:message_id/read', ...access, controller.read);

module.exports = router;
