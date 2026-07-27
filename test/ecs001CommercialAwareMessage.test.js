'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCommercialAwareMessageProcessor,
  resolveConversationRef
} = require('../services/commercial/commercialAwareMessageService');

function createPersistence(owner = 'AI') {
  const calls = { observations: [], followUps: [] };
  return {
    calls,
    async getConversationControl() {
      return { conversationOwner: owner };
    },
    async saveConversationControl(input) {
      owner = input.conversationOwner;
      return { conversationOwner: owner };
    },
    async createFollowUp(input) {
      calls.followUps.push(input);
      return { id: 'follow-up-1', ...input };
    },
    async recordCommercialObservation(input) {
      calls.observations.push(input);
      return { id: 'observation-1' };
    }
  };
}

test('resolveConversationRef prefers explicit conversation reference', () => {
  assert.equal(resolveConversationRef({
    externalUserId: '50511111111@c.us',
    metadata: { conversationRef: 'conversation-123' }
  }), 'conversation-123');
});

test('suppresses model execution when HUMAN owns conversation', async () => {
  let modelCalls = 0;
  const processor = createCommercialAwareMessageProcessor({
    persistence: createPersistence('HUMAN'),
    async processMessageImpl() {
      modelCalls += 1;
      return { reply: 'No debe generarse' };
    }
  });

  const result = await processor({
    message: 'Ya envié los datos',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50511111111@c.us'
  });

  assert.equal(modelCalls, 0);
  assert.equal(result.shouldReply, false);
  assert.equal(result.reply, '');
  assert.equal(result.status, 'suppressed');
  assert.equal(result.suppressionReason, 'CONVERSATION_OWNED_BY_HUMAN');
});

test('continues normal model response and schedules detected commitment', async () => {
  const persistence = createPersistence('AI');
  const processor = createCommercialAwareMessageProcessor({
    persistence,
    async processMessageImpl() {
      return {
        reply: 'Perfecto, quedo pendiente.',
        model: 'test-model',
        context: { ownerMode: false }
      };
    }
  });

  const result = await processor({
    message: 'Mañana deposito',
    externalUserId: '50522222222@c.us'
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, 'Perfecto, quedo pendiente.');
  assert.equal(persistence.calls.followUps.length, 1);
  assert.equal(persistence.calls.observations.length, 1);
});

test('fails open when CONNECT persistence is unavailable', async () => {
  const errors = [];
  const processor = createCommercialAwareMessageProcessor({
    persistence: {
      async getConversationControl() {
        throw new Error('CONNECT DOWN');
      },
      async saveConversationControl() {},
      async createFollowUp() {},
      async recordCommercialObservation() {}
    },
    logger: { error(...args) { errors.push(args); } },
    async processMessageImpl() {
      return { reply: 'Seguimos atendiendo.', context: { ownerMode: false } };
    }
  });

  const result = await processor({
    message: 'Hola',
    externalUserId: '50533333333@c.us'
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.reply, 'Seguimos atendiendo.');
  assert.equal(errors.length, 1);
});