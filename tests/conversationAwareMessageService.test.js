const test = require('node:test');
const assert = require('node:assert/strict');

const {
  SUPPRESS_REPLY_TEXT,
  processMessageWithConversationEvents
} = require('../services/conversationAwareMessageService');

test('human takeover registra inbound y no ejecuta ELAN IA', async () => {
  const events = [];
  let aiCalled = false;

  const result = await processMessageWithConversationEvents({
    message: 'Hola, necesito ayuda',
    platform: 'ELANVISUAL',
    phone: '50588888888',
    externalUserId: '50588888888@c.us',
    metadata: {
      chatId: '50588888888@c.us',
      messageId: 'WAHA-001',
      messageType: 'text'
    }
  }, {
    publishConversationEvent: async event => {
      events.push(event);
      return { assignment: 'human', conversationId: 'conv-1' };
    },
    processMessage: async () => {
      aiCalled = true;
      return { reply: 'No debería ejecutarse' };
    }
  });

  assert.equal(aiCalled, false);
  assert.equal(events.length, 1);
  assert.equal(events[0].direction, 'inbound');
  assert.equal(events[0].actor, 'customer');
  assert.equal(result.status, 'human_takeover');
  assert.equal(result.suppressReply, true);
  assert.equal(result.reply, SUPPRESS_REPLY_TEXT);
});

test('asignación AI procesa y publica inbound y outbound', async () => {
  const events = [];
  let aiCalls = 0;

  const result = await processMessageWithConversationEvents({
    message: 'Cuánto cuesta un rótulo',
    platform: 'ELANVISUAL',
    phone: '50588888888',
    externalUserId: '50588888888@c.us',
    metadata: {
      chatId: '50588888888@c.us',
      messageId: 'WAHA-002',
      messageType: 'text'
    }
  }, {
    publishConversationEvent: async event => {
      events.push(event);
      return event.direction === 'inbound' ? { assignment: 'ai' } : { ok: true };
    },
    processMessage: async () => {
      aiCalls += 1;
      return {
        reply: 'Claro. ¿Lo querés con iluminación?',
        context: {
          platform: 'ELANVISUAL',
          commercialState: {
            intent: 'quotation',
            conversationStatus: 'qualifying'
          }
        },
        createdAt: '2026-08-07T15:00:00.000Z'
      };
    }
  });

  assert.equal(aiCalls, 1);
  assert.equal(result.reply, 'Claro. ¿Lo querés con iluminación?');
  assert.equal(events.length, 2);
  assert.equal(events[0].direction, 'inbound');
  assert.equal(events[1].direction, 'outbound');
  assert.equal(events[1].actor, 'elan_ai');
  assert.equal(events[1].assignment, 'ai');
  assert.equal(events[1].intent, 'quotation');
  assert.equal(events[1].phase, 'qualifying');
  assert.equal(events[1].lastQuestion, '¿Lo querés con iluminación?');
});
