'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQuotationCaption,
  buildQuotationMessage,
  publicQuotationUrl,
  resolvePdfUrl,
  sendQuotationByWhatsApp,
  validateQuotationDelivery
} = require('../services/vqs/quotationWahaDeliveryService');

const payload = {
  quotationId: 'quotation-123',
  quotationNumber: 'COT-EV-2026-0100',
  customerName: 'Cliente Demo',
  phone: '78828089',
  totalUsd: 360,
  documentUrl: 'https://cdn.elankav.com/quotations/COT-EV-2026-0100.pdf',
  items: [{ title: 'Rótulo interior', subtotalUsd: 360 }],
  installments: [
    { label: 'Anticipo', percentage: 60, amountUsd: 216 },
    { label: 'Saldo', percentage: 40, amountUsd: 144 }
  ]
};

test('construye enlace oficial cuando Document Engine aún no publica URL', () => {
  assert.equal(
    publicQuotationUrl({ quotationId: payload.quotationId, env: {} }),
    'https://visual.elankav.com/cotizaciones/quotation-123'
  );
});

test('resuelve únicamente URLs públicas válidas para el PDF', () => {
  assert.equal(resolvePdfUrl(payload.documentUrl), payload.documentUrl);
  assert.equal(resolvePdfUrl('javascript:alert(1)'), '');
  assert.equal(resolvePdfUrl(''), '');
});

test('construye mensaje comercial con total, pagos y enlace oficial', () => {
  const message = buildQuotationMessage(payload, { env: {} });
  assert.match(message, /COT-EV-2026-0100/);
  assert.match(message, /\$360\.00/);
  assert.match(message, /Anticipo 60%: \$216\.00/);
  assert.match(message, /https:\/\/cdn\.elankav\.com\/quotations\/COT-EV-2026-0100\.pdf/);
  assert.doesNotMatch(message, /wa\.me/);
});

test('construye leyenda breve para el documento PDF', () => {
  const caption = buildQuotationCaption(payload);
  assert.match(caption, /Cliente Demo/);
  assert.match(caption, /COT-EV-2026-0100/);
  assert.match(caption, /\$360\.00/);
});

test('valida teléfono, identificador, número y PDF de cotización', () => {
  assert.deepEqual(validateQuotationDelivery({}), [
    'phone es obligatorio y debe ser válido',
    'quotationId es obligatorio',
    'quotationNumber es obligatorio',
    'documentUrl PDF es obligatorio'
  ]);
});

test('rechaza el envío cuando el PDF todavía no está disponible', async () => {
  await assert.rejects(
    sendQuotationByWhatsApp({ ...payload, documentUrl: '' }, { delivery: {} }),
    (error) => error.code === 'VQS_WHATSAPP_PDF_NOT_READY'
  );
});

test('envía el PDF mediante el adapter WAHA y confirma después de aceptación', async () => {
  const calls = [];
  const result = await sendQuotationByWhatsApp(payload, {
    env: {},
    delivery: {
      async sendFile(input) {
        calls.push(input);
        return { chatId: '50578828089@c.us', messageId: 'message-1' };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].phone, '50578828089');
  assert.equal(calls[0].fileUrl, payload.documentUrl);
  assert.equal(calls[0].mimeType, 'application/pdf');
  assert.equal(calls[0].fileName, 'COT-EV-2026-0100.pdf');
  assert.match(calls[0].caption, /COT-EV-2026-0100/);
  assert.equal(result.delivered, true);
  assert.equal(result.deliveryType, 'document');
  assert.equal(result.messageId, 'message-1');
});