const test = require('node:test');
const assert = require('node:assert/strict');

const { checkHumanTakeover } = require('../services/messageService');

test('no consulta CONNECT fuera de WhatsApp', async () => {
  let called = false;
  const result = await checkHumanTakeover({
    normalizedMessage: 'hola',
    platform: 'ELANVISUAL',
    channel: 'web',
    externalUserId: 'u1',
    phone: '50588888888',
    metadata: {},
    publishFn: async () => {
      called = true;
      return { assignment: 'human' };
    }
  });

  assert.equal(result, false);
  assert.equal(called, false);
});

test('detecta assignment human usando el mismo externalMessageId', async () => {
  let published = null;
  const result = await checkHumanTakeover({
    normalizedMessage: 'necesito ayuda',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50588888888@c.us',
    phone: '50588888888',
    metadata: {
      messageId: 'WAHA-001',
      chatId: '50588888888@c.us',
      messageType: 'text',
      session: 'default'
    },
    publishFn: async event => {
      published = event;
      return { ok: true, duplicate: true, assignment: 'human' };
    }
  });

  assert.equal(result, true);
  assert.equal(published.externalMessageId, 'WAHA-001');
  assert.equal(published.chatId, '50588888888@c.us');
  assert.equal(published.actorType, 'customer');
});

test('mantiene ELAN IA cuando assignment sigue en ai', async () => {
  const result = await checkHumanTakeover({
    normalizedMessage: 'hola',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50588888888@c.us',
    phone: '50588888888',
    metadata: {
      messageId: 'WAHA-002',
      chatId: '50588888888@c.us'
    },
    publishFn: async () => ({ ok: true, duplicate: true, assignment: 'ai' })
  });

  assert.equal(result, false);
});
