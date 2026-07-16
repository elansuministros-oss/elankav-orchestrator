export const QUOTE_CORE_VERSION = '1.0.0';

export const QUOTE_SOURCES = Object.freeze([
  'design',
  'store',
  'manual'
]);

export const DESIGN_MODES = Object.freeze([
  'required',
  'optional',
  'not_required'
]);

export const QUOTATION_STATUSES = Object.freeze([
  'draft',
  'quoted',
  'sent',
  'viewed',
  'approved',
  'awaiting_deposit',
  'deposit_confirmed',
  'rejected',
  'expired',
  'cancelled'
]);

export const PROJECT_STATUSES = Object.freeze([
  'pending_activation',
  'active',
  'design',
  'work_order_ready',
  'production',
  'installation',
  'completed',
  'cancelled'
]);

export const PROJECT_EVENT_TYPES = Object.freeze([
  'quotation.created',
  'quotation.sent',
  'quotation.viewed',
  'quotation.approved',
  'quotation.follow_up_recorded',
  'quotation.deposit_requested',
  'quotation.deposit_confirmed',
  'project.activated',
  'work_order.created',
  'purchase_order.created',
  'supplier.assigned',
  'purchase.receipt_uploaded',
  'project.stage_changed',
  'project.completed'
]);

const asNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeSource = (source = {}) => ({
  type: QUOTE_SOURCES.includes(source.type) ? source.type : 'manual',
  sourceId: source.sourceId || '',
  designRequestId: source.designRequestId || '',
  storeProductId: source.storeProductId || '',
  storeCartId: source.storeCartId || '',
  designMode: DESIGN_MODES.includes(source.designMode) ? source.designMode : 'optional'
});

export function createQuoteProject(input = {}) {
  const now = new Date().toISOString();
  const items = Array.isArray(input.items) ? input.items : [];
  const subtotalUsd = items.reduce(
    (sum, item) => sum + asNumber(item.subtotalUsd ?? (asNumber(item.quantity, 1) * asNumber(item.unitPriceUsd))),
    0
  );
  const discountUsd = asNumber(input.pricing?.discountUsd);
  const taxUsd = asNumber(input.pricing?.taxUsd);
  const totalUsd = asNumber(input.pricing?.totalUsd, subtotalUsd - discountUsd + taxUsd);
  const exchangeRate = asNumber(input.pricing?.exchangeRate);
  const payableTotalNio = asNumber(input.pricing?.payableTotalNio, totalUsd * exchangeRate);

  return {
    contractVersion: QUOTE_CORE_VERSION,
    quotation: {
      quotationId: input.quotation?.quotationId || '',
      quotationNumber: input.quotation?.quotationNumber || '',
      platformId: input.quotation?.platformId || 'ELANVISUAL',
      status: QUOTATION_STATUSES.includes(input.quotation?.status) ? input.quotation.status : 'draft',
      publicToken: input.quotation?.publicToken || '',
      publicUrl: input.quotation?.publicUrl || '',
      issuedAt: input.quotation?.issuedAt || now,
      validUntil: input.quotation?.validUntil || '',
      source: normalizeSource(input.quotation?.source)
    },
    project: {
      projectId: input.project?.projectId || '',
      projectNumber: input.project?.projectNumber || '',
      status: PROJECT_STATUSES.includes(input.project?.status) ? input.project.status : 'pending_activation',
      currentStage: input.project?.currentStage || 'quotation',
      priority: input.project?.priority || 'normal',
      expectedDeliveryAt: input.project?.expectedDeliveryAt || '',
      activatedAt: input.project?.activatedAt || '',
      completedAt: input.project?.completedAt || ''
    },
    relations: {
      customerId: input.relations?.customerId || '',
      executiveId: input.relations?.executiveId || '',
      designRequestId: input.relations?.designRequestId || '',
      storeCartId: input.relations?.storeCartId || '',
      orderId: input.relations?.orderId || ''
    },
    customerSnapshot: {
      name: input.customerSnapshot?.name || '',
      companyName: input.customerSnapshot?.companyName || '',
      phone: input.customerSnapshot?.phone || '',
      email: input.customerSnapshot?.email || '',
      address: input.customerSnapshot?.address || ''
    },
    executiveSnapshot: {
      executiveId: input.executiveSnapshot?.executiveId || input.relations?.executiveId || '',
      name: input.executiveSnapshot?.name || '',
      role: input.executiveSnapshot?.role || 'Ejecutivo Comercial',
      phone: input.executiveSnapshot?.phone || '',
      email: input.executiveSnapshot?.email || '',
      photoUrl: input.executiveSnapshot?.photoUrl || ''
    },
    items: items.map((item, index) => ({
      itemId: item.itemId || `item-${index + 1}`,
      productId: item.productId || '',
      designId: item.designId || '',
      title: item.title || `Ítem ${index + 1}`,
      description: item.description || '',
      quantity: asNumber(item.quantity, 1),
      unit: item.unit || 'unidad',
      unitPriceUsd: asNumber(item.unitPriceUsd),
      subtotalUsd: asNumber(item.subtotalUsd, asNumber(item.quantity, 1) * asNumber(item.unitPriceUsd)),
      imageUrl: item.imageUrl || '',
      features: Array.isArray(item.features) ? item.features : [],
      internalData: item.internalData || null
    })),
    pricing: {
      currency: 'USD',
      settlementCurrency: 'NIO',
      subtotalUsd,
      discountUsd,
      taxRate: asNumber(input.pricing?.taxRate),
      taxUsd,
      totalUsd,
      exchangeRate,
      exchangeRateDate: input.pricing?.exchangeRateDate || now.slice(0, 10),
      payableTotalNio
    },
    paymentTerms: {
      type: input.paymentTerms?.type || '60_40',
      installments: Array.isArray(input.paymentTerms?.installments) ? input.paymentTerms.installments : []
    },
    followUp: {
      ownerExecutiveId: input.followUp?.ownerExecutiveId || input.relations?.executiveId || '',
      lastFollowUpAt: input.followUp?.lastFollowUpAt || '',
      nextFollowUpAt: input.followUp?.nextFollowUpAt || '',
      nextAction: input.followUp?.nextAction || '',
      notes: input.followUp?.notes || ''
    },
    audit: {
      createdAt: input.audit?.createdAt || now,
      createdBy: input.audit?.createdBy || '',
      updatedAt: input.audit?.updatedAt || now,
      updatedBy: input.audit?.updatedBy || ''
    }
  };
}

export function validateQuoteProject(document) {
  const errors = [];
  if (!document?.quotation?.platformId) errors.push('quotation.platformId es obligatorio');
  if (!QUOTE_SOURCES.includes(document?.quotation?.source?.type)) errors.push('quotation.source.type no es válido');
  if (!document?.relations?.customerId) errors.push('relations.customerId es obligatorio');
  if (!document?.relations?.executiveId) errors.push('relations.executiveId es obligatorio');
  if (!Array.isArray(document?.items) || document.items.length === 0) errors.push('Debe existir al menos un ítem');
  if (!(Number(document?.pricing?.exchangeRate) > 0)) errors.push('pricing.exchangeRate debe ser mayor que cero');
  if (!(Number(document?.pricing?.totalUsd) >= 0)) errors.push('pricing.totalUsd debe ser válido');
  if (!(Number(document?.pricing?.payableTotalNio) >= 0)) errors.push('pricing.payableTotalNio debe ser válido');

  const installments = document?.paymentTerms?.installments || [];
  if (installments.length > 0) {
    const totalPercentage = installments.reduce((sum, item) => sum + asNumber(item.percentage), 0);
    if (Math.abs(totalPercentage - 100) > 0.001) errors.push('Las cuotas deben sumar exactamente 100%');
  }

  return { ok: errors.length === 0, errors };
}
