'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  coordinateCommercialMessage
} = require('../services/commercial/commercialConversationCoordinator');

function createPersistence(owner = 'AI') {
  const calls = [];
  return {
    calls,
    async getConversationControl() {
      calls.push(['getConversationControl']);
      return { conversationOwner: owner };
    },
    async saveConversationControl(payload) {
      calls.push(['saveConversationControl', payload]);
      return { conversationOwner: payload.conversationOwner };
    },
    async createFollowUp(payload) {
      calls.push(['createFollowUp', payload]);
      return { id: 'fu-1', ...payload };
    },
    async recordCommercialObservation(payload) {
      calls.push(['recordCommercialObservation', payload]);
      return { id: 'obs-1' };
    }
  };
}

test('programa follow-up cuando cliente promete depositar mañana', async () => {
  const persistence = createPersistence('AI');
  const result = await coordinateCommercialMessage({
    persistence,
    conversationRef: 'conv-1',
    message: 'Mañana deposito',
    now: new Date('2026-07-27T14:00:00.000Z')
  });

  assert.equal(result.shouldReply, true);
  assert.equal(result.shouldScheduleFollowUp, true);
  assert.equal(result.followUpRecord.id, 'fu-1');
  assert.equal(
    persistence.calls.some(([name]) => name === 'createFollowUp'),
    true
  );
});

test('conversationOwner HUMAN registra pero no responde ni agenda', async () => {
  const persistence = createPersistence('HUMAN');
  const result = await coordinateCommercialMessage({
    persistence,
    conversationRef: 'conv-2',
    message: 'Te confirmo mañana'
  });

  assert.equal(result.shouldReply, false);
  assert.equal(result.shouldScheduleFollowUp, false);
  assert.equal(result.suppressionReason, 'CONVERSATION_OWNED_BY_HUMAN');
  assert.equal(
    persistence.calls.some(([name]) => name === 'recordCommercialObservation'),
    true
  );
  assert.equal(
    persistence.calls.some(([name]) => name === 'createFollowUp'),
    false
  );
});

test('owner puede devolver conversación a AI conservando contexto', async () => {
  const persistence = createPersistence('HUMAN');
  const result = await coordinateCommercialMessage({
    persistence,
    conversationRef: 'conv-3',
    message: 'Seguí atendiendo este cliente',
    isOwnerMessage: true,
    context: { targetConversationRef: 'conv-3' }
  });

  assert.equal(result.ownershipCommand.command, 'RELEASE_CONVERSATION');
  assert.equal(result.ownership.conversationOwner, 'AI');
  assert.equal(result.shouldReply, true);
  const save = persistence.calls.find(([name]) => name === 'saveConversationControl');
  assert.equal(save[1].conversationOwner, 'AI');
});
