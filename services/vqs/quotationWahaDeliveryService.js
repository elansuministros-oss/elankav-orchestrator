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

function publicQuotationUrl({ projectId, env = process.env } = {}) {
  const id = String(projectId || '').trim();
  if (!id) return '';
  const baseUrl = String(env.ELANVISUAL_PUBLIC_URL || DEFAULT_PUBLIC_BASE_URL).replace(/\/+$/, '');
  return `${baseUrl}/cotizaciones/publicas/${encodeURIComponent(id)}`;
}

function buildQuotationMessage(payload = {}, options = {}) {
  const customerName = String(payload.customerName || '').trim();
  const quotationNumber = String(payload.quotationNumber || '').trim();
  const items = Array.isArray(payload.items) ? payload.items : [];
  const installments = Array.isArray(payload.installments) ? payload.installments : [];
  const publicUrl = publicQuotationUrl({ projectId: payload.projectId, env: options.env });

  return [
    customerName ? `Hola, ${customerName}.` : 'Hola.',
    '',
    `Te compartimos la cotización${quotationNumber ? ` ${quotationNumber}` : ''} de ELANVISUAL.`,
    '',
    ...items.map((item) => `• ${String(item.title || 'Producto').trim()}: ${money(item.subtotalUsd)}`),
    items.length ? '' : null,
    `Total: ${money(payload.totalUsd)}`,
    ...installments.map((payment) => `${String(payment.label || 'Pago').trim()} ${Number(payment.percentage || 0)}%: ${money(payment.amountUsd)}`),
    '',
    `Ver cotización y descargar PDF: ${publicUrl}`,
    '',
    'Quedamos atentos a tu confirmación.'
  ].filter((line) => line !== null).join('\n');
}

function validateQuotationDelivery(payload = {}) {
  const errors = [];
  if (!normalizePhone(payload.phone)) errors.push('phone es obligatorio y debe ser válido');
  if (!String(payload.projectId || '').trim()) errors.push('projectId es obligatorio');
  if (!String(payload.quotationId || '').trim()) errors.push('quotationId es obligatorio');
  if (!String(payload.quotationNumber || '').trim()) errors.push('quotationNumber es obligatorio');
  return errors;
}

async function sendQuotationByWhatsApp(payload = {}, { delivery, env = process.env } = {}) {
  const errors = validateQuotationDelivery(payload);
  if (errors.length) {
    const error = new Error('VQS_WHATSAPP_INVALID');
    error.code = 'VQS_WHATSAPP_INVALID';
    error.details = errors;
    throw error;
  }

  const phone = normalizePhone(payload.phone);
  const adapter = delivery || createWahaDeliveryAdapter({ env });
  const text = buildQuotationMessage(payload, { env });
  const sent = await adapter.sendText({ phone, text });

  return Object.freeze({
    delivered: true,
    deliveryType: 'public-link',
    phone,
    chatId: sent.chatId,
    messageId: sent.messageId || null,
    projectId: String(payload.projectId).trim(),
    quotationId: String(payload.quotationId).trim(),
    quotationNumber: String(payload.quotationNumber).trim(),
    publicUrl: publicQuotationUrl({ projectId: payload.projectId, env })
  });
}

module.exports = {
  DEFAULT_PUBLIC_BASE_URL,
  buildQuotationMessage,
  publicQuotationUrl,
  sendQuotationByWhatsApp,
  validateQuotationDelivery
};