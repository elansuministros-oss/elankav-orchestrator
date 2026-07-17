const { ACTIVE_WORK_ORDER_SOURCE_TYPES } = require('./contract');
const { WORK_ORDER_STATUSES, canTransitionWorkOrderStatus } = require('./states');

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validateWorkOrderContract(document) {
  const errors = [];

  if (!document || typeof document !== 'object') errors.push('WorkOrderContract es obligatorio');
  if (!hasText(document?.workOrder?.platformId)) errors.push('workOrder.platformId es obligatorio');
  if (!WORK_ORDER_STATUSES.includes(document?.workOrder?.status)) errors.push('workOrder.status no es valido');
  if (!hasText(document?.workOrder?.title)) errors.push('workOrder.title es obligatorio');
  if (!ACTIVE_WORK_ORDER_SOURCE_TYPES.includes(document?.source?.type)) {
    errors.push('source.type no esta activo para WorkOrderContract v1');
  }
  if (!Array.isArray(document?.items) || document.items.length === 0) errors.push('items debe contener al menos un item');

  for (const [index, item] of (document?.items || []).entries()) {
    if (!hasText(item.title)) errors.push(`items[${index}].title es obligatorio`);
    if (!(Number(item.quantity) > 0)) errors.push(`items[${index}].quantity debe ser mayor que cero`);
  }

  return { ok: errors.length === 0, errors };
}

function validateWorkOrderPatch(input = {}) {
  const patch = {};
  const errors = [];

  if (Object.hasOwn(input, 'title')) {
    if (!hasText(input.title)) errors.push('title no puede estar vacio');
    else patch.title = input.title.trim();
  }
  if (Object.hasOwn(input, 'priority')) patch.priority = String(input.priority || '').trim() || 'normal';
  if (Object.hasOwn(input, 'scheduledStartAt')) patch.scheduled_start_at = input.scheduledStartAt || null;
  if (Object.hasOwn(input, 'scheduledEndAt')) patch.scheduled_end_at = input.scheduledEndAt || null;
  if (Object.hasOwn(input, 'productionScope')) patch.production_scope = input.productionScope || {};
  if (Object.hasOwn(input, 'schedule')) patch.schedule = input.schedule || {};
  if (Object.hasOwn(input, 'quality')) patch.quality = input.quality || {};
  if (Object.hasOwn(input, 'metadata')) patch.metadata = input.metadata || {};

  if (!Object.keys(patch).length && !errors.length) errors.push('No hay campos permitidos para actualizar');
  return { ok: errors.length === 0, errors, patch };
}

function validateWorkOrderStatusChange(currentStatus, nextStatus) {
  if (!WORK_ORDER_STATUSES.includes(nextStatus)) {
    return { ok: false, errors: ['status no es valido'] };
  }
  if (!canTransitionWorkOrderStatus(currentStatus, nextStatus)) {
    return { ok: false, errors: [`Transicion no permitida: ${currentStatus} -> ${nextStatus}`] };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  validateWorkOrderContract,
  validateWorkOrderPatch,
  validateWorkOrderStatusChange
};
