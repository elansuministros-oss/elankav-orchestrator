'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

require('../services/ownerSellerTemporaryCredentialPatch');
require('../services/ownerSellerPreviewConfirmationPatch');
require('../services/ownerSellerPreviewSanitizePatch');
const { sellerMutationPriority } = require('../services/ownerSellerMutationPriorityPatch');
const commandService = require('../services/elanUnifiedOwnerCommandService');

test('delete intent wins over incidental mostrame wording and creates a seller preview command', () => {
  const message = `ELAN, eliminá físicamente al vendedor cuyo WhatsApp es +505 7511 4256.\n\nAntes de hacer cualquier cambio, mostrame el PREVIO completo del vendedor que encontraste y pedime confirmación.`;

  const direct = sellerMutationPriority(message);
  assert.equal(direct?.sellerPreview, true);
  assert.equal(direct?.action, 'delete');
  assert.equal(direct?.query, '+505 7511 4256');

  const command = commandService.detectOwnerUnifiedCommand(message);
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.action, 'delete');
  assert.equal(command?.query, '+505 7511 4256');
  assert.equal(command?.tool, 'previsualizar_eliminar_vendedor');
  assert.notEqual(command?.sellerReadOnlyAudit, true);
});
