'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  BUSINESS_COMMANDS,
  buildProviderQuoteMessage,
  detectOwnerBusinessCommand,
  parseProviderQuoteRequest
} = require('../services/ownerBusinessCommandService');

test('OWNER-PROVIDER-WA-REGRESSION-01 reconoce orden natural de escribir a proveedor', () => {
  const command = parseProviderQuoteRequest(
    'ESCRIBE AL PROVEEDOR PLAY MARKETING Y PREGUNTA POR LOS CORTES DE LA DRA ABIGAIL'
  );

  assert.equal(command?.type, BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST);
  assert.equal(command?.providerName, 'play marketing');
  assert.equal(command?.item, 'los cortes de la dra abigail');
  assert.equal(command?.requestKind, 'status');
});

test('OWNER-PROVIDER-WA-REGRESSION-01 entra al router comercial y no cae a consulta general', () => {
  const command = detectOwnerBusinessCommand(
    'Escribe al proveedor Play Marketing y pregunta por los cortes de la Dra Abigail'
  );

  assert.equal(command?.type, BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST);
  assert.equal(command?.requestKind, 'status');
});

test('OWNER-PROVIDER-WA-REGRESSION-01 conserva solicitud de precio anterior', () => {
  const command = parseProviderQuoteRequest(
    'Pedile precio a Play Marketing de vinil adhesivo'
  );

  assert.equal(command?.type, BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST);
  assert.equal(command?.providerName, 'play marketing');
  assert.equal(command?.item, 'vinil adhesivo');
  assert.equal(command?.requestKind, 'quote');
});

test('OWNER-PROVIDER-WA-REGRESSION-01 mensaje de seguimiento no inventa precio', () => {
  const message = buildProviderQuoteMessage('los cortes de la Dra. Abigail', 'status');

  assert.match(message, /consultar por los cortes de la Dra\. Abigail/i);
  assert.match(message, /estado/i);
  assert.match(message, /revisión o entrega/i);
  assert.doesNotMatch(message, /precio/i);
});

test('OWNER-PROVIDER-WA-REGRESSION-01 conserva plantilla de cotización previa', () => {
  const message = buildProviderQuoteMessage('vinil adhesivo', 'quote');

  assert.match(message, /precio/i);
  assert.match(message, /IVA/i);
  assert.match(message, /tiempo de entrega/i);
});
