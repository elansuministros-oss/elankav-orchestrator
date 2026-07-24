const VQS_PROJECT_INTAKE_VERSION = '1.0.0';

const ALLOWED_SOURCES = new Set(['manual', 'design', 'store', 'api']);
const ALLOWED_PAYMENT_TYPES = new Set(['cash', '60_40', '60_20_20', 'custom']);

function text(value = '') {
  return String(value ?? '').trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeAssetReference(value, itemId = '') {
  if (typeof value === 'string') return text(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const asset = {};
  [
    'assetId',
    'bucket',
    'objectPath',
    'object_path',
    'path',
    'mimeType',
    'mime_type',
    'kind',
    'itemId',
    'item_id'
  ].forEach((field) => {
    const valueText = text(value[field]);
    if (valueText) asset[field] = valueText;
  });

  const sizeBytes = number(value.sizeBytes ?? value.size_bytes, 0);
  if (sizeBytes > 0) asset.sizeBytes = sizeBytes;
  if (!asset.itemId && itemId) asset.itemId = itemId;
  if (!asset.objectPath && asset.path) asset.objectPath = asset.path;
  if (!asset.path && asset.objectPath) asset.path = asset.objectPath;
  if (!asset.kind && asset.bucket && asset.objectPath) asset.kind = 'quotation-image';
  const hasStableReference = Boolean(asset.assetId || (asset.bucket && asset.objectPath));

  if (!hasStableReference) {
    [
      'signedUrl',
      'signed_url',
      'url',
      'publicUrl',
      'public_url',
      'imageUrl',
      'image_url',
      'src'
    ].forEach((field) => {
      const valueText = text(value[field]);
      if (valueText) asset[field] = valueText;
    });
  }

  return Object.keys(asset).length ? asset : null;
}

function normalizeAssetList(values = [], itemId = '') {
  return (Array.isArray(values) ? values : [])
    .map((value) => safeAssetReference(value, itemId))
    .filter((value) => typeof value === 'string' ? Boolean(value) : Boolean(value));
}

function normalizeMetadata(metadata = {}) {
  const normalized = metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...metadata }
    : {};

  if (Array.isArray(normalized.sourceAssets)) {
    normalized.sourceAssets = normalizeAssetList(normalized.sourceAssets);
  }

  return normalized;
}

function normalizeProjectIntake(body = {}) {
  const platform = text(body.platform).toUpperCase();
  const sourceType = ALLOWED_SOURCES.has(body.source?.type) ? body.source.type : 'manual';
  const metadata = normalizeMetadata(body.metadata);

  return {
    contractVersion: VQS_PROJECT_INTAKE_VERSION,
    platform,
    source: {
      type: sourceType,
      sourceId: text(body.source?.sourceId),
      designRequestId: text(body.source?.designRequestId),
      storeProductId: text(body.source?.storeProductId),
      storeCartId: text(body.source?.storeCartId),
      designMode: text(body.source?.designMode) || 'optional'
    },
    customer: {
      customerId: text(body.customer?.customerId),
      name: text(body.customer?.name),
      companyName: text(body.customer?.companyName),
      phone: text(body.customer?.phone),
      email: text(body.customer?.email),
      address: text(body.customer?.address)
    },
    executive: {
      executiveId: text(body.executive?.executiveId),
      name: text(body.executive?.name),
      role: text(body.executive?.role) || 'Ejecutivo Comercial',
      phone: text(body.executive?.phone),
      email: text(body.executive?.email),
      photoUrl: text(body.executive?.photoUrl)
    },
    project: {
      title: text(body.project?.title),
      priority: text(body.project?.priority) || 'normal',
      expectedDeliveryAt: text(body.project?.expectedDeliveryAt),
      images: Array.isArray(body.project?.images)
        ? normalizeAssetList(body.project.images)
        : []
    },
    items: Array.isArray(body.items)
      ? body.items.map((item = {}, index) => ({
          itemId: text(item.itemId) || `item-${index + 1}`,
          productId: text(item.productId),
          designId: text(item.designId),
          title: text(item.title),
          description: text(item.description),
          quantity: number(item.quantity, 1),
          unit: text(item.unit) || 'unidad',
          unitPriceUsd: number(item.unitPriceUsd),
          subtotalUsd: number(item.subtotalUsd, number(item.quantity, 1) * number(item.unitPriceUsd)),
          imageUrl: text(item.imageUrl),
          images: Array.isArray(item.images) ? normalizeAssetList(item.images, text(item.itemId) || `item-${index + 1}`) : [],
          features: Array.isArray(item.features) ? item.features.map(text).filter(Boolean) : [],
          internalData: item.internalData || null
        }))
      : [],
    pricing: {
      currency: 'USD',
      settlementCurrency: 'NIO',
      discountUsd: number(body.pricing?.discountUsd),
      taxRate: number(body.pricing?.taxRate),
      taxUsd: number(body.pricing?.taxUsd),
      totalUsd: number(body.pricing?.totalUsd),
      exchangeRate: number(body.pricing?.exchangeRate),
      exchangeRateDate: text(body.pricing?.exchangeRateDate),
      payableTotalNio: number(body.pricing?.payableTotalNio)
    },
    payments: {
      type: ALLOWED_PAYMENT_TYPES.has(body.payments?.type) ? body.payments.type : '60_40',
      installments: Array.isArray(body.payments?.installments) ? body.payments.installments : []
    },
    metadata
  };
}

function validateProjectIntake(contract = {}) {
  const errors = [];
  if (!text(contract.platform)) errors.push('platform es obligatorio');
  if (!text(contract.customer?.customerId)) errors.push('customer.customerId es obligatorio');
  if (!text(contract.executive?.executiveId)) errors.push('executive.executiveId es obligatorio');
  if (!Array.isArray(contract.items) || contract.items.length === 0) errors.push('items debe contener al menos un ítem');
  if (!(number(contract.pricing?.exchangeRate) > 0)) errors.push('pricing.exchangeRate debe ser mayor que cero');

  contract.items?.forEach((item, index) => {
    if (!text(item.title)) errors.push(`items[${index}].title es obligatorio`);
    if (!(number(item.quantity) > 0)) errors.push(`items[${index}].quantity debe ser mayor que cero`);
    if (!(number(item.unitPriceUsd) >= 0)) errors.push(`items[${index}].unitPriceUsd debe ser válido`);
  });

  const installments = contract.payments?.installments || [];
  if (contract.payments?.type === 'custom' && installments.length === 0) {
    errors.push('payments.installments es obligatorio para pagos custom');
  }
  if (installments.length > 0) {
    const total = installments.reduce((sum, installment) => sum + number(installment.percentage), 0);
    if (Math.abs(total - 100) > 0.001) errors.push('Las cuotas deben sumar exactamente 100%');
  }

  return { ok: errors.length === 0, errors };
}

function toQuoteProjectInput(contract) {
  const sourceAssets = normalizeAssetList(contract.metadata?.sourceAssets);
  return {
    quotation: {
      platformId: contract.platform,
      status: 'draft',
      source: { ...contract.source }
    },
    project: {
      title: contract.project.title,
      status: 'pending_activation',
      currentStage: 'quotation',
      priority: contract.project.priority,
      expectedDeliveryAt: contract.project.expectedDeliveryAt,
      images: [...contract.project.images]
    },
    relations: {
      customerId: contract.customer.customerId,
      executiveId: contract.executive.executiveId,
      designRequestId: contract.source.designRequestId,
      storeCartId: contract.source.storeCartId,
      ...(sourceAssets.length ? { sourceAssets } : {})
    },
    customerSnapshot: { ...contract.customer },
    executiveSnapshot: { ...contract.executive },
    items: contract.items,
    pricing: contract.pricing,
    paymentTerms: contract.payments,
    metadata: contract.metadata,
    followUp: { ownerExecutiveId: contract.executive.executiveId }
  };
}

module.exports = {
  VQS_PROJECT_INTAKE_VERSION,
  normalizeProjectIntake,
  normalizeAssetList,
  validateProjectIntake,
  toQuoteProjectInput
};
