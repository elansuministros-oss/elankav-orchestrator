const { ACTIVE_PURCHASE_ORDER_SOURCE_TYPES } = require('./contract');
const { PURCHASE_ORDER_STATUSES, canTransitionPurchaseOrderStatus } = require('./states');

function hasText(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function validatePurchaseOrderContract(document) {
  const errors = [];

  if (!document || typeof document !== 'object') errors.push('PurchaseOrderContract es obligatorio');
  if (!hasText(document?.purchaseOrder?.platformId)) errors.push('purchaseOrder.platformId es obligatorio');
  if (!PURCHASE_ORDER_STATUSES.includes(document?.purchaseOrder?.status)) errors.push('purchaseOrder.status no es valido');
  if (!hasText(document?.purchaseOrder?.title)) errors.push('purchaseOrder.title es obligatorio');
  if (!ACTIVE_PURCHASE_ORDER_SOURCE_TYPES.includes(document?.source?.type)) {
    errors.push('source.type no esta activo para PurchaseOrderContract v1');
  }
  if (document?.source?.type === 'quotation' && !hasText(document.source.quotationId || document.source.sourceId)) {
    errors.push('source.quotationId es obligatorio para compras originadas en cotizacion');
  }
  if (document?.source?.type === 'workOrder' && !hasText(document.source.workOrderId || document.source.sourceId)) {
    errors.push('source.workOrderId es obligatorio para compras originadas en orden de trabajo');
  }
  if (!Array.isArray(document?.items) || document.items.length === 0) errors.push('items debe contener al menos un item');

  for (const [index, item] of (document?.items || []).entries()) {
    if (!hasText(item.title)) errors.push(`items[${index}].title es obligatorio`);
    if (!(Number(item.quantity) > 0)) errors.push(`items[${index}].quantity debe ser mayor que cero`);
  }

  return { ok: errors.length === 0, errors };
}

function validatePurchaseOrderPatch(input = {}) {
  const patch = {};
  const errors = [];

  if (Object.hasOwn(input, 'title')) {
    if (!hasText(input.title)) errors.push('title no puede estar vacio');
    else patch.title = input.title.trim();
  }
  if (Object.hasOwn(input, 'supplierSnapshot')) patch.supplier_snapshot = input.supplierSnapshot || {};
  if (Object.hasOwn(input, 'items')) {
    if (!Array.isArray(input.items) || input.items.length === 0) errors.push('items debe contener al menos un item');
    else patch.items = input.items;
  }
  if (Object.hasOwn(input, 'totals')) patch.totals = input.totals || {};
  if (Object.hasOwn(input, 'delivery')) patch.delivery = input.delivery || {};
  if (Object.hasOwn(input, 'metadata')) patch.metadata = input.metadata || {};

  if (!Object.keys(patch).length && !errors.length) errors.push('No hay campos permitidos para actualizar');
  return { ok: errors.length === 0, errors, patch };
}

function validatePurchaseOrderStatusChange(currentStatus, nextStatus) {
  if (!PURCHASE_ORDER_STATUSES.includes(nextStatus)) {
    return { ok: false, errors: ['status no es valido'] };
  }
  if (!canTransitionPurchaseOrderStatus(currentStatus, nextStatus)) {
    return { ok: false, errors: [`Transicion no permitida: ${currentStatus} -> ${nextStatus}`] };
  }
  return { ok: true, errors: [] };
}

module.exports = {
  validatePurchaseOrderContract,
  validatePurchaseOrderPatch,
  validatePurchaseOrderStatusChange
};
