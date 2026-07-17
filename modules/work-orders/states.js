const WORK_ORDER_STATUSES = Object.freeze([
  'draft',
  'approved',
  'scheduled',
  'in_production',
  'quality_review',
  'completed',
  'cancelled'
]);

const WORK_ORDER_STATUS_TRANSITIONS = Object.freeze({
  draft: ['approved', 'cancelled'],
  approved: ['scheduled', 'cancelled'],
  scheduled: ['in_production', 'cancelled'],
  in_production: ['quality_review', 'cancelled'],
  quality_review: ['completed', 'in_production', 'cancelled'],
  completed: [],
  cancelled: []
});

function isValidWorkOrderStatus(status) {
  return WORK_ORDER_STATUSES.includes(status);
}

function canTransitionWorkOrderStatus(fromStatus, toStatus) {
  if (!isValidWorkOrderStatus(fromStatus) || !isValidWorkOrderStatus(toStatus)) return false;
  if (fromStatus === toStatus) return true;
  return WORK_ORDER_STATUS_TRANSITIONS[fromStatus].includes(toStatus);
}

module.exports = {
  WORK_ORDER_STATUSES,
  WORK_ORDER_STATUS_TRANSITIONS,
  isValidWorkOrderStatus,
  canTransitionWorkOrderStatus
};
