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
