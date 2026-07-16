'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isCrmStateExpired,
  isOwnerOperationalInterrupt,
  touchCrmState
} = require('../services/crmConversationService');

test('ROUTER-PRIORITY-01 descarta estados CRM sin fecha', () => {
  assert.equal(
    isCrmStateExpired({ type: 'supplier', step: 'type' }),
    true
  );
});

test('ROUTER-PRIORITY-01 conserva un estado CRM reciente', () => {
  const state = touchCrmState({
    type: 'supplier',
    step: 'type'
  });

  assert.equal(isCrmStateExpired(state), false);
});

test('ROUTER-PRIORITY-01 interrumpe proveedor cuando Owner corrige la clasificación', () => {
  assert.equal(
    isOwnerOperationalInterrupt('No es proveedor'),
    true
  );
});

test('ROUTER-PRIORITY-01 prioriza orden Owner de buscar y enviar enlace', () => {
  assert.equal(
    isOwnerOperationalInterrupt(
      'Busca este número en WhatsApp y envíale el link para hacer su diseño'
    ),
    true
  );
});

test('ROUTER-PRIORITY-01 no interrumpe una respuesta válida del formulario CRM', () => {
  assert.equal(
    isOwnerOperationalInterrupt('Proveedor mixto de materiales y servicios'),
    false
  );
});
