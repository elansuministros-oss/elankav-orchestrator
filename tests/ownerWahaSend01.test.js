'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  DESIGN_PORTAL_URL,
  buildDesignLinkMessage,
  extractPhone,
  sendDesignLink
} = require('../services/ownerWahaSendService');
const {
  OWNER_COMMANDS,
  detectOwnerCommand
} = require('../services/ownerCommandService');

test('OWNER-WAHA-SEND-01 extrae y normaliza número Nicaragua', () => {
  assert.equal(
    extractPhone('Enviale el enlace a +505 8391 2342'),
    '50583912342'
  );
});

test('OWNER-WAHA-SEND-01 usa el enlace oficial de diseño', () => {
  const message = buildDesignLinkMessage();
  assert.match(message, new RegExp(DESIGN_PORTAL_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(message, /código de seguimiento/i);
});

test('OWNER-WAHA-SEND-01 detecta orden Owner completa', () => {
  const command = detectOwnerCommand(
    'Busca el número +505 8391 2342 en WhatsApp y envíale el enlace para realizar su diseño'
  );

  assert.equal(command.type, OWNER_COMMANDS.SEND_DESIGN_LINK);
  assert.equal(command.phone, '50583912342');
});

test('OWNER-WAHA-SEND-01 no captura mensaje sin número', () => {
  const command = detectOwnerCommand(
    'Enviale el enlace de diseño'
  );

  assert.notEqual(command?.type, OWNER_COMMANDS.SEND_DESIGN_LINK);
});

test('OWNER-WAHA-SEND-01 envía mediante adapter existente', async () => {
  const calls = [];
  const result = await sendDesignLink({
    phone: '83912342',
    delivery: {
      async sendText(payload) {
        calls.push(payload);
        return {
          chatId: '50583912342@c.us',
          messageId: 'msg-test'
        };
      }
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].phone, '50583912342');
  assert.match(calls[0].text, /visual\.elankav\.com\/diseno\/whatsapp/);
  assert.equal(result.messageId, 'msg-test');
});
