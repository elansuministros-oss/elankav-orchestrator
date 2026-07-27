'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canTransition,
  transitionCommercialState
} = require('../services/commercial/commercialStateMachine');
const {
  detectFollowUpCommitment
} = require('../services/commercial/followUpDetector');
const {
  buildOwnershipPolicy,
  detectOwnershipCommand
} = require('../services/commercial/conversationOwnershipService');

test('permite avanzar una cotización hasta compromiso de pago', () => {
  assert.equal(canTransition('QUOTE_SENT', 'PAYMENT_COMMITMENT'), true);
  const result = transitionCommercialState({
    from: 'QUOTE_SENT',
    to: 'PAYMENT_COMMITMENT',
    reason: 'cliente prometió depósito',
    now: new Date('2026-07-27T14:00:00.000Z')
  });
  assert.equal(result.state, 'PAYMENT_COMMITMENT');
  assert.equal(result.changed, true);
});

test('rechaza transición arbitraria desde ganado', () => {
  assert.throws(
    () => transitionCommercialState({ from: 'WON', to: 'NEGOTIATION' }),
    error => error.code === 'COMMERCIAL_STATE_TRANSITION_INVALID'
  );
});

test('detecta mañana deposito como seguimiento prioritario', () => {
  const result = detectFollowUpCommitment({
    message: 'Mañana deposito',
    now: new Date('2026-07-27T08:00:00-06:00')
  });
  assert.equal(result.detected, true);
  assert.equal(result.reason, 'PAYMENT');
  assert.equal(result.priority, 'HIGH');
  assert.equal(result.confidence, 0.94);
});

test('ownership HUMAN bloquea respuestas y seguimientos, pero conserva contexto', () => {
  const command = detectOwnershipCommand('Este cliente lo tomo.');
  assert.equal(command.owner, 'HUMAN');
  const policy = buildOwnershipPolicy({ conversationOwner: command.owner });
  assert.equal(policy.shouldReplyToCustomer, false);
  assert.equal(policy.shouldScheduleFollowUps, false);
  assert.equal(policy.shouldRecordContext, true);
});

test('owner puede devolver la conversación a ELAN IA', () => {
  const command = detectOwnershipCommand('Seguí atendiendo este cliente.');
  assert.equal(command.owner, 'AI');
  const policy = buildOwnershipPolicy({ conversationOwner: command.owner });
  assert.equal(policy.shouldReplyToCustomer, true);
  assert.equal(policy.shouldScheduleFollowUps, true);
});
