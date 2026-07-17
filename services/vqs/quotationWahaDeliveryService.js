'use strict';

const {
  createWahaDeliveryAdapter,
  normalizePhone
} = require('../../adapters/wahaDeliveryAdapter');

const DEFAULT_PUBLIC_BASE_URL = 'https://visual.elankav.com';

function money(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD'
  }).format(Number(value || 0));
}

function publicQuotationUrl({ quotationId, documentUrl, env = process.env } = {}) {
  const explicitUrl = String(documentUrl || '').trim();
  if (explicitUrl) {
    try {
      const url = new URL(explicitUrl);
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.toString();
    } catch {
      // Ignore invalid external URL and use the official viewer route.
    }
  }

  const id = String(quotationId || '').trim();
  if (!id) return '';
  const baseUrl = String(env.ELANVISUAL_PUBLIC_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
  return `${baseUrl}/cotizaciones/${encodeURIComponent(id)}`;
}

function resolvePdfUrl(documentUrl) {
  const value = String(documentUrl || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    return url.toString();
  } catch {
    return '';
  }
}

function sanitizeFileName(value) {
  return String(value || 'cotizacion')
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'cotizacion';
}

function buildQuotationMessage(payload = {}, options = {}) {
  const customerName = String(payload.customerName || '').trim();
  const quotationNumber = String(payload.quotationNumber || '').trim();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const installments = Array.isArray(payload.installments) ? payload.installments : [];
  const documentUrl = publicQuotationUrl({
    quotationId: payload.quotationId,
    documentUrl: payload.documentUrl,
    env: options.env
  });

  return [
    customerName ? `Hola, ${customerName}.` : 'Hola.',
    '',
    `Te compartimos la cotización${quotationNumber ? ` ${quotationNumber}` : ''} de ELANVISUAL.`,
    '',
    ...items.map((item) => `• ${String(item.title || 'Producto').trim()}: ${money(item.subtotalUsd)}`),
    items.length ? '' : null,
    `Total: ${money(payload.totalUsd)}`,
    ...installments.map((payment) => `${String(payment.label || 'Pago').trim()} ${Number(payment.percentage || 0)}%: ${money(payment.amountUsd)}`),
    documentUrl ? '' : null,
    documentUrl ? `Ver cotización oficial: ${documentUrl}` : null,
    '',
    'Quedamos atentos a tu confirmación.'
  ].filter((line) => line !== null).join('\n');
}

function buildQuotationCaption(payload = {}) {
  const customerName = String(payload.customerName || '').trim();
  const quotationNumber = String(payload.quotationNumber || '').trim();
  return [
    customerName ? `Hola, ${customerName}.` : 'Hola.',
    `Te compartimos la cotización${quotationNumber ? ` ${quotationNumber}` : ''} de ELANVISUAL.`,
    `Total: ${money(payload.totalUsd)}`,
    'Quedamos atentos a tu confirmación.'
  ].join('\n');
}

function validateQuotationDelivery(payload = {}) {
  const errors = [];
  if (!normalizePhone(payload.phone)) errors.push('phone es obligatorio y debe ser válido');
  if (!String(payload.quotationId || '').trim()) errors.push('quotationId es obligatorio');
  if (!String(payload.quotationNumber || '').trim()) errors.push('quotationNumber es obligatorio');
  if (!resolvePdfUrl(payload.documentUrl)) errors.push('documentUrl PDF es obligatorio');
  return errors;
}

async function sendQuotationByWhatsApp(payload = {}, { delivery, env = process.env } = {}) {
  const errors = validateQuotationDelivery(payload);
  if (errors.length) {
    const error = new Error(
      errors.includes('documentUrl PDF es obligatorio')
        ? 'La cotización todavía no tiene un PDF público disponible.'
        : 'VQS_WHATSAPP_INVALID'
    );
    error.code = errors.includes('documentUrl PDF es obligatorio')
      ? 'VQS_WHATSAPP_PDF_NOT_READY'
      : 'VQS_WHATSAPP_INVALID';
    error.details = errors;
    throw error;
  }

  const phone = normalizePhone(payload.phone);
  const adapter = delivery || createWahaDeliveryAdapter({ env });
  const pdfUrl = resolvePdfUrl(payload.documentUrl);
  const fileName = `${sanitizeFileName(payload.quotationNumber)}.pdf`;
  const sent = await adapter.sendFile({
    phone,
    fileUrl: pdfUrl,
    fileName,
    mimeType: 'application/pdf',
    caption: buildQuotationCaption(payload)
  });

  return Object.freeze({
    delivered: true,
    deliveryType: 'document',
    phone,
    chatId: sent.chatId,
    messageId: sent.messageId || null,
    quotationId: String(payload.quotationId).trim(),
    quotationNumber: String(payload.quotationNumber).trim(),
    documentUrl: pdfUrl,
    fileName
  });
}

module.exports = {
  DEFAULT_PUBLIC_BASE_URL,
  buildQuotationCaption,
  buildQuotationMessage,
  publicQuotationUrl,
  resolvePdfUrl,
  sendQuotationByWhatsApp,
  validateQuotationDelivery
};