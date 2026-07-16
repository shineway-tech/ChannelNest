const { logger } = require('@honeykid/ml');
const {
  BillingOrder,
  PaymentAttempt,
} = require('../../models/domain');
const AlipayService = require('../../services/alipay');
const BusinessError = require('../../utils/business_error');
const ErrorCodes = require('../../utils/error_codes');

async function handlePaymentCreationFailure(error, attemptId, orderId) {
  const errorKind = AlipayService.classifyError(error);
  const providerCode = error.providerCode || error.code || 'unknown';
  logger.error(`Alipay website payment failed (${errorKind}, ${providerCode}): ${error.message}`);
  await PaymentAttempt.update({
    status: 'failed', active_order_guard: null, error_code: 'provider_error',
  }, { where: { id: attemptId } });
  await BillingOrder.update(
    { status: 'created', active_payment_attempt_id: null },
    { where: { id: orderId } },
  );
  if (errorKind === 'configuration') {
    throw new BusinessError(
      503,
      ErrorCodes.PAYMENT_CONFIGURATION_INVALID,
      '支付配置校验失败，请联系管理员',
    );
  }
  if (errorKind === 'permission') {
    throw new BusinessError(
      503,
      ErrorCodes.PAYMENT_PERMISSION_DENIED,
      '支付宝商户未开通电脑网站支付或合约已到期，请联系管理员',
    );
  }
  throw new BusinessError(
    503,
    ErrorCodes.PAYMENT_UNAVAILABLE,
    errorKind === 'network' ? '支付服务连接超时，请稍后重试' : '支付宝暂时无法创建订单，请稍后重试',
  );
}

module.exports = {
  handlePaymentCreationFailure,
};
