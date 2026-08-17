'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

const connect = require('../services/ownerBusinessConnectClient');
require('../services/ownerSellerTemporaryCredentialPatch');
const preview = require('../services/ownerSellerPreviewConfirmationPatch');
const commandService = require('../services/elanUnifiedOwnerCommandService');

function tempEnv(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `elan-${name}-`));
  return { ...process.env, OWNER_SELLER_PREVIEW_STORE_PATH: path.join(dir, 'pending.json') };
}

test('seller create is converted to preview instead of direct create', () => {
  const command = commandService.detectOwnerUnifiedCommand('CREA UN NUEVO VENDEDOR EL NOMBRE ES : Juan Ruiz Y SU NUMERO DE WASAP : +505 7511 4256');
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.action, 'create');
  assert.equal(command?.data?.displayName, 'Juan Ruiz');
  assert.equal(command?.data?.whatsapp, '+505 7511 4256');
});

test('seller delete with "cuyo WhatsApp" resolves the phone, never the word cuyo', () => {
  const command = commandService.detectOwnerUnifiedCommand('ELAN, eliminá físicamente al vendedor cuyo WhatsApp es +505 7511 4256 y cuyo nombre actual aparece como: ES : Juan Ruiz Y SU NUMERO DE WASAP : +505 7511 4256');
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.action, 'delete');
  assert.equal(command?.query, '+505 7511 4256');
});

test('read-only seller audit by WhatsApp is specific and not converted to a list-all command', () => {
  const command = commandService.detectOwnerUnifiedCommand('ELAN, buscá específicamente al vendedor con WhatsApp +505 7511 4256 y mostrame sus datos. No hagás ningún cambio.');
  assert.equal(command?.sellerReadOnlyAudit, true);
  assert.equal(command?.query, '+505 7511 4256');
});

test('confirmation controls require an explicit preview id', () => {
  assert.deepEqual(preview.detectControl('CONFIRMAR SELLER-ABC-123'), { sellerPreviewControl: 'confirm', code: 'SELLER-ABC-123', tool: 'confirmar_previo_vendedor' });
  assert.equal(preview.detectControl('CONFIRMAR'), null);
});

test('delete preview performs no write until explicit confirmation', async () => {
  const env = tempEnv('seller-preview-delete');
  let sellers = [{ id: 'seller-1', displayName: 'ES : Juan Ruiz Y SU NUMERO DE WASAP : +505 7511 4256', whatsapp: '+505 7511 4256', status: 'active' }];
  let deleteCalls = 0;
  const originalList = connect.listOwnerSellers;
  const originalDelete = connect.deleteOwnerSeller;
  connect.listOwnerSellers = async () => ({ data: sellers });
  connect.deleteOwnerSeller = async (id) => { deleteCalls += 1; sellers = sellers.filter((seller) => seller.id !== id); return { ok: true, data: { id } }; };
  try {
    const command = commandService.detectOwnerUnifiedCommand('ELAN, eliminá físicamente al vendedor cuyo WhatsApp es +505 7511 4256');
    const previewResult = await commandService.executeOwnerUnifiedCommand({ command, actor: { phone: '50588388940' }, env });
    assert.equal(deleteCalls, 0);
    assert.match(previewResult.reply, /PREVIO — ELIMINAR VENDEDOR/);
    assert.match(previewResult.reply, /NO se hizo ningún cambio en CONNECT/);
    const code = previewResult.reply.match(/CONFIRMAR\s+(SELLER-[A-Z0-9-]+)/)?.[1];
    assert.ok(code);

    const confirmCommand = commandService.detectOwnerUnifiedCommand(`CONFIRMAR ${code}`);
    const confirmed = await commandService.executeOwnerUnifiedCommand({ command: confirmCommand, actor: { phone: '50588388940' }, env });
    assert.equal(deleteCalls, 1);
    assert.match(confirmed.reply, /Eliminación verificada en CONNECT/);
  } finally {
    connect.listOwnerSellers = originalList;
    connect.deleteOwnerSeller = originalDelete;
  }
});
