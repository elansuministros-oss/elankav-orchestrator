'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getToolManifest } = require('../services/elanUnifiedToolRegistry');

function names(actor) {
  return new Set(getToolManifest(actor).map((tool) => tool.name));
}

test('seller Copilot exposes only scoped quotation delivery/open tools', () => {
  const seller = names({
    role: 'seller',
    actorId: 'seller-1',
    sellerId: 'seller-1',
    scopes: [
      'assistant.general',
      'customer.own.read',
      'customer.own.create',
      'quotation.own.read',
      'quotation.own.create',
      'quotation.own.send'
    ]
  });

  assert.equal(seller.has('buscar_cotizacion'), true);
  assert.equal(seller.has('crear_cotizacion'), true);
  assert.equal(seller.has('editar_cotizacion'), true);
  assert.equal(seller.has('abrir_cotizacion'), true);
  assert.equal(seller.has('enviar_cotizacion_cliente'), true);
  assert.equal(seller.has('enviar_cotizacion_email'), true);
  assert.equal(seller.has('buscar_vendedor'), false);
  assert.equal(seller.has('buscar_proveedor'), false);
});

test('owner Copilot retains full quotation delivery/open tools', () => {
  const owner = names({ role: 'owner', actorId: 'owner', authority: 'owner_identity', scopes: ['*'] });
  for (const name of ['buscar_cotizacion','editar_cotizacion','abrir_cotizacion','enviar_cotizacion_cliente','enviar_cotizacion_email']) {
    assert.equal(owner.has(name), true, name);
  }
});
