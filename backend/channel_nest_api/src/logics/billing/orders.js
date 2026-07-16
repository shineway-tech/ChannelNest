const crypto = require('crypto');
const { Op } = require('sequelize');
const {
  MembershipPeriod,
  MembershipPlan,
} = require('../../models/domain');

function plain(row) {
  return row && typeof row.toJSON === 'function' ? row.toJSON() : row;
}

function orderNo() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
  return `MM${stamp}${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function serializeOrder(row) {
  const order = plain(row);
  return {
    id: order.id,
    orderNo: order.order_no,
    orderType: order.order_type,
    productCode: order.product_code,
    product: order.product_snapshot,
    listAmountFen: order.list_amount_fen,
    discountBps: order.discount_bps,
    payAmountFen: order.pay_amount_fen,
    currency: order.currency,
    status: order.status,
    expiresAt: order.expires_at,
    paidAt: order.paid_at,
    createdAt: order.createdAt || order.created_at,
  };
}

async function activeMembership(userId, transaction = null, lock = false) {
  return MembershipPeriod.findOne({
    where: { user_id: userId, status: 'active', ends_at: { [Op.gt]: new Date() } },
    order: [['ends_at', 'DESC']],
    transaction,
    lock: lock && transaction ? transaction.LOCK.UPDATE : undefined,
  }).then(plain);
}

async function planById(id, transaction = null) {
  return MembershipPlan.findOne({ where: { id }, transaction }).then(plain);
}

function pagination(query, defaultPageSize = 10, maxPageSize = 50) {
  const requestedPage = Number(query.page || 1);
  const requestedPageSize = Number(query.page_size || defaultPageSize);
  const page = Number.isInteger(requestedPage) ? Math.max(1, requestedPage) : 1;
  const pageSize = Number.isInteger(requestedPageSize)
    ? Math.min(maxPageSize, Math.max(1, requestedPageSize))
    : defaultPageSize;
  return { page, pageSize };
}

module.exports = {
  activeMembership,
  orderNo,
  pagination,
  planById,
  plain,
  serializeOrder,
};
