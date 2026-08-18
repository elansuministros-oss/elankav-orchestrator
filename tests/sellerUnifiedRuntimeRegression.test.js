'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getToolManifest,
  isAllowed,
  TOOL_DEFINITIONS
} = require('../services/elanUnifiedToolRegistry');

function names(actor) {
  return new Set(getToolManifest(actor).map(tool => tool.name));
}

const sellerActor = {
  role: 'seller',
  sellerId: 'seller-test',
  scopes: [
    'price.authorized.read',
    'customer.read',
    'customer.write',
    'quotation.read',
    'quotation.write'
  ]
};

test('SELLER-RUNTIME-REGRESSION-01 vendedor conserva ciclo comercial permitido', () => {
  const tools = names(sellerActor);

  for (const required of [
    'buscar_precio_autorizado',
    'solicitar_presupuesto',
    'buscar_cliente',
    'crear_cliente',
    'editar_cliente',
    'buscar_cotizacion',
    'crear_cotizacion',
    'editar_cotizacion'
  ]) {
    assert.equal(tools.has(required), true, `${required} debe estar disponible para seller`);
  }
});

test('SELLER-RUNTIME-REGRESSION-01 vendedor no recibe herramientas Owner', () => {
  const tools = names(sellerActor);

  for (const blocked of [
    'desactivar_cliente',
    'crear_proveedor',
    'editar_proveedor',
    'crear_vendedor',
    'editar_vendedor',
    'eliminar_vendedor',
    'configurar_plataformas_vendedor',
    'enviar_mensaje_whatsapp',
    'enviar_cotizacion_cliente'
  ]) {
    assert.equal(tools.has(blocked), false, `${blocked} no debe exponerse a seller`);
  }
});

test('SELLER-RUNTIME-REGRESSION-01 write tools conservan scopes explícitos', () => {
  const requiredScopes = new Map([
    ['crear_cliente', 'customer.write'],
    ['editar_cliente', 'customer.write'],
    ['crear_cotizacion', 'quotation.write'],
    ['editar_cotizacion', 'quotation.write']
  ]);

  for (const [name, scope] of requiredScopes) {
    const definition = TOOL_DEFINITIONS.find(tool => tool.name === name);
    assert.equal(definition?.scope, scope);
    assert.equal(definition?.sellerAllowed, true);
    assert.equal(isAllowed(definition, sellerActor), true);
  }
});

test('SELLER-RUNTIME-REGRESSION-01 actor sin rol seller no hereda permisos comerciales', () => {
  const tools = names({ role: 'prospect', scopes: [] });
  assert.equal(tools.has('solicitar_presupuesto'), false);
  assert.equal(tools.has('crear_cliente'), false);
  assert.equal(tools.has('crear_cotizacion'), false);
});
