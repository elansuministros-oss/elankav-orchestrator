'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMAND_TYPE,
  detectOfficialPricePublish,
  executeOfficialPricePublish
} = require('../services/ownerOfficialPricePublishService');
const { detectOwnerBusinessCommand } = require('../services/ownerBusinessProcessMessageGateway');

test('detects explicit Owner publication of rotulo boton official price', () => {
  const command = detectOfficialPricePublish('ELAN publica el precio oficial de rótulo botón en Precios');
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.sku, 'rotulo-boton');

  const routed = detectOwnerBusinessCommand('ELAN publica la tarifa del rótulo botón acrílico');
  assert.ok(routed);
  assert.equal(routed.type, COMMAND_TYPE);
});

test('does not hijack unrelated publish commands', () => {
  assert.equal(detectOfficialPricePublish('ELAN publica el sitio web'), null);
  assert.equal(detectOfficialPricePublish('ELAN buscá el precio del rótulo botón'), null);
});

test('calls only the protected VQS official publication endpoint', async () => {
  const calls = [];
  const execution = await executeOfficialPricePublish({ type: COMMAND_TYPE, sku: 'rotulo-boton' }, async (path, options) => {
    calls.push({ path, options });
    return {
      data: {
        status: 'PUBLISHED',
        idempotent: false,
        sku: 'rotulo-boton',
        product: {
          title: 'Rotulo boton',
          price: { value: 100, currency: 'USD' },
          baseMeasure: { width: 0.6, height: 0.6 }
        }
      }
    };
  });

  assert.equal(execution.handled, true);
  assert.deepEqual(calls, [{
    path: '/api/v1/business/vqs/pricing/publish-official',
    options: { method: 'POST', body: { sku: 'rotulo-boton' } }
  }]);
  assert.match(execution.outputText, /USD 100/);
  assert.match(execution.outputText, /0.6 × 0.6 m/);
});

test('reports already-published publication as idempotent', async () => {
  const execution = await executeOfficialPricePublish({ type: COMMAND_TYPE, sku: 'rotulo-boton' }, async () => ({
    data: { status: 'ALREADY_PUBLISHED', idempotent: true, sku: 'rotulo-boton', product: {} }
  }));
  assert.match(execution.outputText, /ya estaba publicado/);
  assert.match(execution.outputText, /Idempotente: SÍ/);
});
