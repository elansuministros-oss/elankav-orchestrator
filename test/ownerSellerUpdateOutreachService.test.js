'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const flow = require('../services/ownerSellerUpdateOutreachService');
const { routingArgs } = require('../services/ownerSellerUpdateOutreachMessagePatch');

function tempEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elan-seller-update-'));
  return {
    ...process.env,
    ORCHESTRATOR_OWNER_PHONE: '50588388940',
    OWNER_SELLER_UPDATE_STATE_FILE: path.join(dir, 'state.json'),
    OWNER_SELLER_PREVIEW_STORE_PATH: path.join(dir, 'previews.json')
  };
}
function fakeDelivery(sent) {
  return { async sendText(input) { sent.push(input); return { chatId: `${flow.normalizePhone(input.phone)}@c.us`, messageId: `m-${sent.length}` }; } };
}
function routedMessage(message) {
  return routingArgs({ message }).message;
}

test('detects the real accented short update command using seller name only', () => {
  const detected = flow.detectUpdateOutreachStart(routedMessage('ELAN, escribile a Arq. Karen Vega y actualizá su información.'));
  assert.equal(detected?.query, 'Arq. Karen Vega');
});

test('honorific does not prevent resolving the canonical seller name', () => {
  const matches = flow.findSellerMatches([
    { id: '1', displayName: 'Karen Vega', whatsapp: '+50588887777' },
    { id: '2', displayName: 'Sergio Suarez', whatsapp: '+50588886666' }
  ], 'Arq. Karen Vega');
  assert.equal(matches.length, 1);
  assert.equal(matches[0].id, '1');
});

test('starts outreach by name and sends to official CONNECT WhatsApp', async () => {
  const env = tempEnv();
  const sent = [];
  const result = await flow.startUpdateOutreach({
    message: routedMessage('ELAN, escribile a Arq. Karen Vega y actualizá su información.'),
    phone: '50588388940',
    env
  }, {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => ({ data: [{ id: 'seller-karen', displayName: 'Karen Vega', whatsapp: '+50581234567', email: 'old@example.com' }] })
  });
  assert.equal(result?.handled, true);
  assert.match(result?.reply || '', /Le escribí a Karen Vega/i);
  assert.equal(sent.length, 1);
  assert.equal(flow.normalizePhone(sent[0].phone), '50581234567');
});

test('does not guess when more than one seller matches the name', async () => {
  const env = tempEnv();
  const sent = [];
  const result = await flow.startUpdateOutreach({
    message: routedMessage('ELAN, escribile a Karen Vega y actualizá su información.'),
    phone: '50588388940',
    env
  }, {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => ({ data: [
      { id: '1', displayName: 'Karen Vega', whatsapp: '+50581111111' },
      { id: '2', displayName: 'Karen Vega', whatsapp: '+50582222222' }
    ] })
  });
  assert.equal(result?.handled, true);
  assert.match(result?.reply || '', /varias coincidencias/i);
  assert.equal(sent.length, 0);
});

test('seller reply produces edit preview and sends it to Owner', async () => {
  const env = tempEnv();
  const sent = [];
  const deps = {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => ({ data: [{ id: 'seller-karen', displayName: 'Karen Vega', whatsapp: '+50581234567', email: 'old@example.com', zone: 'Managua' }] }),
    executeOwnerUnifiedCommand: async ({ command }) => {
      assert.equal(command.action, 'edit');
      assert.equal(command.data.email, 'karen@example.com');
      assert.equal(command.data.zone, 'Masaya');
      return { handled: true, reply: '📋 PREVIO — EDITAR VENDEDOR\nCONFIRMAR SELLER-UPDATE1' };
    }
  };
  await flow.startUpdateOutreach({
    message: routedMessage('ELAN, escribile a Arq. Karen Vega y actualizá su información.'),
    phone: '50588388940',
    env
  }, deps);
  const reply = await flow.processSellerReply({
    message: 'Mi nombre completo es Karen Vega, correo karen@example.com, zona Masaya',
    phone: '50581234567',
    env
  }, deps);
  assert.equal(reply?.handled, true);
  assert.match(reply?.reply || '', /Envié los cambios a Erick/i);
  assert.equal(sent.length, 2);
  assert.equal(flow.normalizePhone(sent[1].phone), '50588388940');
  assert.match(sent[1].text, /CONFIRMAR SELLER-UPDATE1/);
});

test('first confirmation prepares a separate credential preview', async () => {
  const env = tempEnv();
  const sent = [];
  let phase = 'edit';
  const deps = {
    delivery: fakeDelivery(sent),
    listOwnerSellers: async () => ({ data: [{ id: 'seller-karen', displayName: 'Karen Vega', whatsapp: '+50581234567', email: 'old@example.com' }] }),
    executeOwnerUnifiedCommand: async ({ command }) => {
      if (phase === 'edit') {
        phase = 'credential';
        return { handled: true, reply: '📋 PREVIO — EDITAR VENDEDOR\nCONFIRMAR SELLER-UPDATE1' };
      }
      assert.equal(command.action, 'credential');
      return { handled: true, reply: '🔐 PREVIO — CREDENCIAL TEMPORAL\nCONFIRMAR SELLER-ACCESS1' };
    }
  };
  await flow.startUpdateOutreach({
    message: routedMessage('ELAN, escribile a Karen Vega y actualizá su información.'),
    phone: '50588388940',
    env
  }, deps);
  await flow.processSellerReply({
    message: 'Correo: karen@example.com',
    phone: '50581234567',
    env
  }, deps);
  const result = await flow.afterOwnerMessage({
    message: 'CONFIRMAR SELLER-UPDATE1',
    phone: '50588388940',
    env
  }, { reply: '✅ Cambio confirmado y verificado en CONNECT.' }, deps);
  assert.match(result?.reply || '', /SEGUNDO PREVIO — ACCESO/);
  assert.match(result?.reply || '', /CONFIRMAR SELLER-ACCESS1/);
  assert.doesNotMatch(result?.reply || '', /Contraseña temporal:/i);
});
