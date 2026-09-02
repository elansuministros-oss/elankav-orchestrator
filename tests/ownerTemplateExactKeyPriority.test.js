'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectOwnerTemplateApproval,
  executeOwnerTemplateApproval
} = require('../services/ownerTemplateApprovalService');

test('la clave exacta de plantilla tiene prioridad sobre palabras de audiencia en restricciones negativas', async () => {
  const message = [
    'ELAN, reenvíame la prueba Owner de la plantilla con clave exacta elanvisual-supplier-network-v1, versión 2.',
    'Envíamela por correo y por WhatsApp.',
    'En WhatsApp: imagen primero y texto después.',
    'Es únicamente una prueba Owner para mí.',
    'No actives campañas.',
    'No envíes a prospectos, clientes ni proveedores externos.'
  ].join(' ');

  const command = detectOwnerTemplateApproval(message);
  assert.equal(command?.input?.action, 'preview');
  assert.equal(command?.input?.key, 'elanvisual-supplier-network-v1');
  assert.equal(command?.input?.supplier, true);
  assert.equal(command?.input?.client, true);
  assert.equal(command?.input?.prospect, true);

  const calls = [];
  const requestImpl = async (path, options) => {
    calls.push([path, options]);
    if (path.endsWith('/owner-template-reviews')) return [
      {
        approved: false,
        template: { id: 'supplier-id', key: 'elanvisual-supplier-network-v1', name: 'Proveedores', version: 2, segment: 'suppliers' },
        evidence: [{ channel: 'email', status: 'sent' }, { channel: 'whatsapp', status: 'sent' }]
      },
      {
        approved: false,
        template: { id: 'prospect-id', key: 'elanvisual-corporate-intro-v3', name: 'Prospectos', version: 1, segment: 'general' },
        evidence: [{ channel: 'email', status: 'pending' }, { channel: 'whatsapp', status: 'pending' }]
      }
    ];
    return { ok: true };
  };

  const result = await executeOwnerTemplateApproval(command, { requestImpl });
  assert.equal(result.handled, true);
  assert.equal(calls[1][0], '/console/api/prospecting/templates/supplier-id/owner-test');
});
