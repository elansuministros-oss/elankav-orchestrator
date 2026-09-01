'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const recruitment = require('../services/ownerSellerRecruitmentService');
const { trustedOwnerArgs } = require('../services/ownerSellerRecruitmentMessagePatch');

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elan-recruitment-'));
  return {
    ...process.env,
    ORCHESTRATOR_OWNER_PHONE: '50588388940',
    OWNER_SELLER_RECRUITMENT_STATE_FILE: path.join(dir, 'state.json'),
    OWNER_SELLER_PREVIEW_STORE_PATH: path.join(dir, 'previews.json')
  };
}

function fakeDelivery(sent) {
  return {
    async sendText(input) {
      sent.push(input);
      return { chatId: `${recruitment.normalizePhone(input.phone)}@c.us`, messageId: `msg-${sent.length}` };
    }
  };
}

test('detects the short Owner command requested for seller recruitment', () => {
  const command = recruitment.detectRecruitmentStart(
    'ELAN, escribile a Juan Ruiz al 75114256 y agregalo a Ventas.',
    'ELANVISUAL'
  );
  assert.equal(command?.candidateName, 'Juan Ruiz');
  assert.equal(command?.candidatePhone, '50575114256');
  assert.equal(command?.department, 'VENTAS');
  assert.equal(command?.platform, 'ELANVISUAL');
});

test('accepts common Owner spelling variants without requiring a long instruction', () => {
  const command = recruitment.detectRecruitmentStart(
    'elan escrivele a Maria Lopez su numero es 88887777 y agragalo a ventas',
    'ELANVISUAL'
  );
  assert.equal(command?.candidateName, 'Maria Lopez');
  assert.equal(command?.candidatePhone, '50588887777');
});

test('uses canonical Owner identity after runtime resolves an incoming WhatsApp LID', () => {
  const raw = {
    message: 'ELAN, escribile a Juan Ruiz al +505 7511 4256 y agregalo a Ventas.',
    phone: '',
    externalUserId: '123456789012345@lid'
  };
  const effective = trustedOwnerArgs(raw, { actorRole: 'owner' });
  assert.equal(effective.phone, recruitment.DEFAULT_OWNER_PHONE);
  assert.equal(effective.externalUserId, recruitment.DEFAULT_OWNER_PHONE);
  assert.equal(effective.message, raw.message);

  const untouched = trustedOwnerArgs(raw, { actorRole: 'prospect' });
  assert.equal(untouched.externalUserId, raw.externalUserId);
});

test('does not contact a candidate when that WhatsApp already belongs to a seller', async () => {
  const env = tempEnv();
  const sent = [];
  const result = await recruitment.startRecruitment({
    message: 'ELAN, escribile a Juan Ruiz al 75114256 y agregalo a Ventas.',
    phone: '50588388940',
    platform: 'ELANVISUAL',
    env
  }, {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => ({ data: [{ id: 'seller-1', displayName: 'Registro existente', whatsapp: '+50575114256' }] })
  });

  assert.equal(result?.handled, true);
  assert.match(result?.reply || '', /ya existe un vendedor/i);
  assert.equal(sent.length, 0);
});

test('collects candidate email and sends Owner a SELLER preview without creating access', async () => {
  const env = tempEnv();
  const sent = [];
  const dependencies = {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => ({ data: [] }),
    executeOwnerUnifiedCommand: async ({ command }) => {
      assert.equal(command.action, 'create');
      assert.equal(command.data.displayName, 'Juan Ruiz');
      assert.equal(command.data.email, 'juan@example.com');
      return { handled: true, reply: '📋 PREVIO — CREAR VENDEDOR\nPara ejecutar: CONFIRMAR SELLER-ABC123' };
    }
  };

  const started = await recruitment.startRecruitment({
    message: 'ELAN, escribile a Juan Ruiz al 75114256 y agregalo a Ventas.',
    phone: '50588388940',
    platform: 'ELANVISUAL',
    env
  }, dependencies);
  assert.equal(started?.handled, true);
  assert.equal(sent.length, 1);
  assert.equal(recruitment.normalizePhone(sent[0].phone), '50575114256');

  const candidate = await recruitment.processCandidateReply({
    message: 'Mi nombre completo es Juan Ruiz y mi correo es juan@example.com',
    phone: '50575114256',
    env
  }, dependencies);

  assert.equal(candidate?.handled, true);
  assert.match(candidate?.reply || '', /envié tus datos a Erick/i);
  assert.equal(sent.length, 2);
  assert.equal(recruitment.normalizePhone(sent[1].phone), '50588388940');
  assert.match(sent[1].text, /CONFIRMAR SELLER-ABC123/);
  assert.match(sent[1].text, /SEGUNDO PREVIO/i);
});

test('first confirmation assigns Ventas and prepares credential preview instead of generating a password', async () => {
  const env = tempEnv();
  const sent = [];
  let previewCalls = 0;
  let platformCall = null;
  const dependencies = {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => previewCalls === 0
      ? ({ data: [] })
      : ({ data: [{ id: 'seller-juan', displayName: 'Juan Ruiz', whatsapp: '+50575114256', email: 'juan@example.com', status: 'active' }] }),
    executeOwnerUnifiedCommand: async ({ command }) => {
      previewCalls += 1;
      if (command.action === 'create') return { handled: true, reply: '📋 PREVIO — CREAR VENDEDOR\nCONFIRMAR SELLER-CREATE1' };
      assert.equal(command.action, 'credential');
      return { handled: true, reply: '🔐 PREVIO — CREDENCIAL TEMPORAL\nCONFIRMAR SELLER-ACCESS1' };
    },
    setOwnerSellerPlatforms: async (sellerId, platforms) => {
      platformCall = { sellerId, platforms };
      return { ok: true };
    }
  };

  await recruitment.startRecruitment({
    message: 'ELAN, escribile a Juan Ruiz al 75114256 y agregalo a Ventas.',
    phone: '50588388940',
    platform: 'ELANVISUAL',
    env
  }, dependencies);
  await recruitment.processCandidateReply({
    message: 'Correo: juan@example.com',
    phone: '50575114256',
    env
  }, dependencies);

  const result = await recruitment.afterOwnerMessage({
    message: 'CONFIRMAR SELLER-CREATE1',
    phone: '50588388940',
    env
  }, {
    reply: '✅ Cambio confirmado y verificado en CONNECT.\nNombre: Juan Ruiz'
  }, dependencies);

  assert.equal(platformCall?.sellerId, 'seller-juan');
  assert.deepEqual(platformCall?.platforms, [{ platform: 'ELANVISUAL', status: 'active' }]);
  assert.match(result?.reply || '', /SEGUNDO PREVIO — ACCESO/);
  assert.match(result?.reply || '', /CONFIRMAR SELLER-ACCESS1/);
  assert.doesNotMatch(result?.reply || '', /Contraseña temporal:/i);
});
