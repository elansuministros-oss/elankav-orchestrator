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
  quotationId: 'quotation-123',
  quotationNumber: 'COT-EV-2026-0100',
  customerName: 'Cliente Demo',
  phone: '78828089',
  totalUsd: 360,
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

test('construye mensaje comercial con total, pagos y enlace oficial', () => {
  const message = buildQuotationMessage(payload, { env: {} });
  assert.match(message, /COT-EV-2026-0100/);
  assert.match(message, /\$360\.00/);
  assert.match(message, /Anticipo 60%: \$216\.00/);
  assert.match(message, /https:\/\/visual\.elankav\.com\/cotizaciones\/quotation-123/);
  assert.doesNotMatch(message, /wa\.me/);
});

test('valida teléfono, identificador y número de cotización', () => {
  assert.deepEqual(validateQuotationDelivery({}), [
    'phone es obligatorio y debe ser válido',
    'quotationId es obligatorio',
    'quotationNumber es obligatorio'
  ]);
});

test('envía mediante el adapter WAHA y confirma después de aceptación', async () => {
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
  assert.match(calls[0].text, /Ver cotización oficial/);
  assert.equal(result.delivered, true);
  assert.equal(result.messageId, 'message-1');
});
