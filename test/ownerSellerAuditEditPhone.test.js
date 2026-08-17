'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectSellerAuditByPhone,
  detectSellerNameEdit
} = require('../services/ownerSellerTemporaryCredentialPatch');

test('detects seller audit by WhatsApp even when message also asks to show details', () => {
  const command = detectSellerAuditByPhone(`ELAN, buscá específicamente al vendedor con WhatsApp +505 7511 4256 y mostrame:
- nombre
- WhatsApp
- teléfono
- correo
- código de vendedor
- estado
- ID

No hagás ningún cambio.`);

  assert.equal(command?.sellerAuditByPhone, true);
  assert.equal(command?.sellerPhone, '50575114256');
});

test('detects natural seller rename with colon after "a"', () => {
  const command = detectSellerNameEdit(`ELAN, editá al vendedor ES : Juan Ruiz Y SU NUMERO DE WASAP : +505 7511 4256.

Cambiá el nombre a: Juan Ruiz

Mantené su WhatsApp: +505 7511 4256`);

  assert.equal(command?.sellerNameEdit, true);
  assert.equal(command?.newName, 'Juan Ruiz');
  assert.equal(command?.whatsapp, '+505 7511 4256');
  assert.match(command?.sellerQuery || '', /Juan Ruiz/);
});
