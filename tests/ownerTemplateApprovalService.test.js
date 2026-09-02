'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOwnerTemplateApproval,
  executeOwnerTemplateApproval
} = require('../services/ownerTemplateApprovalService');

test('detecta aprobación natural de la plantilla de proveedores', () => {
  const command = detectOwnerTemplateApproval('ELAN, apruebo la plantilla de proveedores');
  assert.equal(command?.type, 'business_owner_template_approval');
  assert.equal(command?.input?.supplier, true);
});

test('solo aprueba la versión con ambas pruebas registradas', async () => {
  const calls = [];
  const requestImpl = async (path, options) => {
    calls.push([path, options]);
    if (path.endsWith('/owner-template-reviews')) return [{
      approved: false,
      template: { id: '11111111-1111-4111-8111-111111111111', key: 'elanvisual-supplier-network-v1', name: 'Proveedores', version: 1 },
      evidence: [{ channel: 'email', status: 'sent' }, { channel: 'whatsapp', status: 'sent' }]
    }];
    return { approved: true, template: { name: 'Proveedores', version: 1 } };
  };
  const result = await executeOwnerTemplateApproval(
    detectOwnerTemplateApproval('apruebo la plantilla elanvisual-supplier-network-v1'),
    { requestImpl }
  );
  assert.equal(result.handled, true);
  assert.match(result.outputText, /únicamente esta versión/);
  assert.equal(calls[1][0], '/api/v1/prospecting/templates/11111111-1111-4111-8111-111111111111/owner-approve');
});
