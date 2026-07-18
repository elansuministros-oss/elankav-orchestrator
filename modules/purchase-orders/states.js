const PURCHASE_ORDER_STATUSES = Object.freeze([
  'draft',
  'pending_approval',
  'approved',
  'ordered',
  'partially_received',
  'received',
  'cancelled'
]);

const PURCHASE_ORDER_STATUS_TRANSITIONS = Object.freeze({
  draft: ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'cancelled'],
  approved: ['ordered', 'cancelled'],
  ordered: ['partially_received', 'received', 'cancelled'],
  partially_received: ['received', 'cancelled'],
  received: [],
  cancelled: []
});

function isValidPurchaseOrderStatus(status) {
  return PURCHASE_ORDER_STATUSES.includes(status);
}

function canTransitionPurchaseOrderStatus(fromStatus, toStatus) {
  if (!isValidPurchaseOrderStatus(fromStatus) || !isValidPurchaseOrderStatus(toStatus)) return false;
  if (fromStatus === toStatus) return true;
  return PURCHASE_ORDER_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

module.exports = {
  PURCHASE_ORDER_STATUSES,
  PURCHASE_ORDER_STATUS_TRANSITIONS,
  isValidPurchaseOrderStatus,
  canTransitionPurchaseOrderStatus
};
