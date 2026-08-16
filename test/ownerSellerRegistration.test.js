'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isSellerStart,
  parseSellerFields,
  sellerSummary
} = require('../services/ownerSellerRegistrationService');

test('recognizes natural Owner commands to register a seller', () => {
  assert.equal(isSellerStart('ELAN, registra un vendedor.'), true);
  assert.equal(isSellerStart('quiero cargar una vendedora'), true);
  assert.equal(isSellerStart('agrega vendedor nuevo'), true);
  assert.equal(isSellerStart('lista los proveedores'), false);
});

test('extracts seller fields without requiring a rigid format', () => {
  const fields = parseSellerFields([
    'Nombre: Ana Pérez',
    'WhatsApp: +505 8888-7777',
    'Correo: ana@example.com',
    'Zona: Managua'
  ].join('\n'));

  assert.equal(fields.displayName, 'Ana Pérez');
  assert.equal(fields.whatsapp, '+50588887777');
  assert.equal(fields.email, 'ana@example.com');
  assert.equal(fields.zone, 'Managua');
});

test('confirmation summary explicitly avoids persisting identity-document data', () => {
  const text = sellerSummary({
    data: {
      displayName: 'Ana Pérez',
      whatsapp: '+50588887777',
      email: 'ana@example.com'
    }
  });

  assert.match(text, /¿Confirmás que registre este vendedor\?/);
  assert.match(text, /no guardaré la foto ni el número de documento/i);
});
