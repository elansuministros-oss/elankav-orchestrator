const { resolveQuotationTemplate } = require('./documentTemplateService');

function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sanitizeItem(item = {}) {
  const quantity = asNumber(item.quantity, 1);
  const unitPrice = asNumber(item.unitPriceUsd ?? item.unitPrice);
  const subtotal = asNumber(item.subtotalUsd ?? item.subtotal, quantity * unitPrice);

  return {
    id: item.itemId || item.id || '',
    productId: item.productId || '',
    designId: item.designId || '',
    title: item.title || '',
    description: item.description || '',
    quantity,
    unit: item.unit || 'unidad',
    unitPrice,
    subtotal,
    imageUrl: item.imageUrl || '',
    images: Array.isArray(item.images) ? [...item.images] : [],
    features: Array.isArray(item.features) ? [...item.features] : []
  };
}

function buildQuotationDocument({ document, quotation, project } = {}) {
  if (!document || !quotation || !project) {
    const error = new Error('document, quotation y project son obligatorios');
    error.code = 'VQS_DOCUMENT_BUILD_INPUT_INVALID';
    throw error;
  }

  const items = Array.isArray(document.items) ? document.items.map(sanitizeItem) : [];
  const subtotal = asNumber(document.pricing?.subtotalUsd, items.reduce((sum, item) => sum + item.subtotal, 0));
  const discount = asNumber(document.pricing?.discountUsd);
  const tax = asNumber(document.pricing?.taxUsd);
  const total = asNumber(document.pricing?.totalUsd, subtotal - discount + tax);

  const quotationDocument = {
    schemaVersion: '1.0.0',
    documentType: 'quotation',
    platformId: document.quotation.platformId,
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number,
    projectId: project.id,
    projectNumber: project.project_number,
    customer: { ...document.customerSnapshot },
    executive: { ...document.executiveSnapshot },
    project: {
      title: project.title || items[0]?.title || 'Proyecto',
      status: project.status,
      stage: project.current_stage,
      priority: project.priority || 'normal',
      expectedDeliveryAt: project.expected_delivery_at || '',
      images: Array.isArray(document.project?.images) ? [...document.project.images] : []
    },
    items,
    currency: 'USD',
    settlementCurrency: 'NIO',
    totals: {
      subtotal,
      discount,
      taxRate: asNumber(document.pricing?.taxRate),
      tax,
      total,
      exchangeRate: asNumber(document.pricing?.exchangeRate),
      exchangeRateDate: document.pricing?.exchangeRateDate || '',
      payableTotalNio: asNumber(document.pricing?.payableTotalNio, total * asNumber(document.pricing?.exchangeRate))
    },
    paymentTerms: { ...document.paymentTerms },
    source: { ...document.quotation.source },
    metadata: { generatedAt: new Date().toISOString() }
  };

  return resolveQuotationTemplate(quotationDocument);
}

class QuotationDocumentBuilder {
  build(input) {
    return buildQuotationDocument(input);
  }
}

module.exports = {
  QuotationDocumentBuilder,
  buildQuotationDocument,
  sanitizeItem
};
