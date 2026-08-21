'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
require('../services/ownerSellerTemporaryCredentialPatch');
require('../services/ownerSellerPreviewConfirmationPatch');
require('../services/ownerSellerPreviewSanitizePatch');
const { detectOwnerUnifiedCommand } = require('../services/elanUnifiedOwnerCommandService');

test('extracts seller natural language fields into a safe preview', () => {
  const command = detectOwnerUnifiedCommand('CREA UN NUEVO VENDEDOR EL NOMBRE ES : Juan Ruiz Y SU NUMERO DE WASAP : +505 7511 4256');
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.action, 'create');
  assert.equal(command?.data?.displayName, 'Juan Ruiz');
  assert.equal(command?.data?.whatsapp, '+505 7511 4256');
});

test('extracts conventional seller fields into a safe preview', () => {
  const command = detectOwnerUnifiedCommand('crea vendedor nombre: Ana Pérez, WhatsApp: +505 8888 7777');
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.data?.displayName, 'Ana Pérez');
  assert.equal(command?.data?.whatsapp, '+505 8888 7777');
});

test('extracts se llama seller phrasing into a safe preview', () => {
  const command = detectOwnerUnifiedCommand('crea una vendedora se llama María López y su WhatsApp es +505 8777 6666');
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.data?.displayName, 'María López');
  assert.equal(command?.data?.whatsapp, '+505 8777 6666');
});

test('extracts exact multiline provider edit fields from Owner WhatsApp', () => {
  const command = detectOwnerUnifiedCommand(`ELAN, actualiza el proveedor Más Publicidad.

Contacto: Katy
WhatsApp / Teléfono: +505 8285 0298
País: Nicaragua
Plataforma: ELANVISUAL
Tipo: Materiales y productos
Categoría: Publicidad / promocionales / impresión
Especialidades: Sky Dancer, plumas publicitarias`);

  assert.equal(command?.tool, 'editar_proveedor');
  assert.deepEqual(command?.resolve, { type: 'provider', query: 'Más Publicidad' });
  assert.deepEqual(command?.arguments?.data, {
    whatsapp: '+505 8285 0298',
    phone: '+505 8285 0298',
    contactName: 'Katy',
    country: 'Nicaragua',
    platforms: ['ELANVISUAL'],
    kinds: ['materials_products'],
    categories: ['Publicidad / promocionales / impresión'],
    specialties: ['Sky Dancer', 'plumas publicitarias']
  });
});

test('keeps one-line provider edit compatibility while resolving the target name', () => {
  const command = detectOwnerUnifiedCommand('actualiza el proveedor Vargas Centro WhatsApp: +505 8577-4826');
  assert.equal(command?.tool, 'editar_proveedor');
  assert.deepEqual(command?.resolve, { type: 'provider', query: 'Vargas Centro' });
  assert.equal(command?.arguments?.data?.whatsapp, '+505 8577-4826');
});
