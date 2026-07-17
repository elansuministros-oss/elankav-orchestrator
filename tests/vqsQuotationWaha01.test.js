'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildQuotationMessage,
  publicQuotationUrl,
  sendQuotationByWhatsApp,
  validateQuotationDelivery
} = require('../services/vqs/quotationWahaDeliveryService');

const payload = {
  projectId: 'project-123',
  quotationId: 'quotation-123',
  quotationNumber: 'COT-EV-2026-0100',
  customerName: 'Cliente Demo',
  phone: '78828089',
  totalUsd: 360,
  documentUrl: 'https://cdn.elankav.com/quotations/COT-EV-2026-0100.pdf',
  items: [{ title: 'Rotulo interior', subtotalUsd: 360 }],
  installments: [
    { label: 'Anticipo', percentage: 60, amountUsd: 216 },
    { label: 'Saldo', percentage: 40, amountUsd: 144 }
  ]
};

test('construye enlace publico oficial por projectId', () => {
  assert.equal(
    publicQuotationUrl({ projectId: payload.projectId, env: {} }),
    'https://visual.elankav.com/cotizaciones/publicas/project-123'
  );
});

test('construye mensaje comercial con total, pagos y enlace publico', () => {
  const message = buildQuotationMessage(payload, { env: {} });
  assert.match(message, /COT-EV-2026-0100/);
  assert.match(message, /\$360\.00/);
  assert.match(message, /Anticipo 60%: \$216\.00/);
  assert.match(message, /https:\/\/visual\.elankav\.com\/cotizaciones\/publicas\/project-123/);
  assert.doesNotMatch(message, /wa\.me/);
});

test('valida telefono, proyecto, identificador y numero de cotizacion', () => {
  const errors = validateQuotationDelivery({});
  assert.equal(errors.length, 4);
  assert.match(errors[0], /^phone es obligatorio/);
  assert.equal(errors[1], 'projectId es obligatorio');
  assert.equal(errors[2], 'quotationId es obligatorio');
  assert.equal(errors[3], 'quotationNumber es obligatorio');
});

test('rechaza el envio cuando falta projectId', async () => {
  await assert.rejects(
    sendQuotationByWhatsApp({ ...payload, projectId: '' }, { delivery: {} }),
    (error) => error.code === 'VQS_WHATSAPP_INVALID'
  );
});

test('envia enlace publico mediante el adapter WAHA y confirma despues de aceptacion', async () => {
  const calls = [];
  const result = await sendQuotationByWhatsApp(payload, {
    env: {},
    delivery: {
      async sendText(input) {
        calls.push(input);
        return { chatId: '50578828089@c.us', messageId: 'message-1' };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].phone, '50578828089');
  assert.match(calls[0].text, /COT-EV-2026-0100/);
  assert.match(calls[0].text, /cotizaciones\/publicas\/project-123/);
  assert.equal(result.delivered, true);
  assert.equal(result.deliveryType, 'public-link');
  assert.equal(result.messageId, 'message-1');
  assert.equal(result.publicUrl, 'https://visual.elankav.com/cotizaciones/publicas/project-123');
});
