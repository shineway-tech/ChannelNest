const Router = require('koa-router');
const { koaBody } = require('koa-body');
const controller = require('./ai');
const { checkImagePromptOptimize, checkImages, checkText } = require('./filter');
const requireRegisteredUser = require('../../../middlewares/require_registered_user');

const router = new Router();
const access = requireRegisteredUser({ requireEmail: true });
const multipart = koaBody({
  multipart: true,
  formidable: { maxFileSize: 10 * 1024 * 1024, maxFiles: 1, keepExtensions: false },
});

router.post('/text', access, checkText, controller.text);
router.post('/text/stream', access, checkText, controller.textStream);
router.get('/image-options', access, controller.imageOptions);
router.post('/image-references', access, multipart, controller.uploadReference);
router.delete('/image-references/:reference_id', access, controller.deleteReference);
router.post('/image-prompt/optimize', access, checkImagePromptOptimize, controller.optimizeImagePrompt);
router.post('/images', access, checkImages, controller.images);
router.get('/requests/:request_id', access, controller.request);
router.post('/requests/:request_id/outputs/:output_id/ack', access, controller.ackOutput);
router.post('/requests/:request_id/ack', access, controller.ack);

module.exports = router;
