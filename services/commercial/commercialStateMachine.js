'use strict';

const COMMERCIAL_STATES = Object.freeze([
  'NEW',
  'INTERESTED',
  'QUALIFIED',
  'QUOTE_REQUESTED',
  'QUOTE_SENT',
  'AWAITING_DECISION',
  'PAYMENT_COMMITMENT',
  'FOLLOW_UP',
  'NEGOTIATION',
  'WON',
  'LOST',
  'PAUSED'
]);

const TERMINAL_STATES = new Set(['WON', 'LOST']);

const TRANSITIONS = Object.freeze({
  NEW: new Set(['INTERESTED', 'QUALIFIED', 'PAUSED', 'LOST']),
  INTERESTED: new Set(['QUALIFIED', 'QUOTE_REQUESTED', 'FOLLOW_UP', 'PAUSED', 'LOST']),
  QUALIFIED: new Set(['QUOTE_REQUESTED', 'QUOTE_SENT', 'NEGOTIATION', 'FOLLOW_UP', 'PAUSED', 'LOST']),
  QUOTE_REQUESTED: new Set(['QUOTE_SENT', 'FOLLOW_UP', 'PAUSED', 'LOST']),
  QUOTE_SENT: new Set(['AWAITING_DECISION', 'NEGOTIATION', 'PAYMENT_COMMITMENT', 'FOLLOW_UP', 'WON', 'LOST', 'PAUSED']),
  AWAITING_DECISION: new Set(['NEGOTIATION', 'PAYMENT_COMMITMENT', 'FOLLOW_UP', 'WON', 'LOST', 'PAUSED']),
  PAYMENT_COMMITMENT: new Set(['FOLLOW_UP', 'WON', 'NEGOTIATION', 'PAUSED', 'LOST']),
  FOLLOW_UP: new Set(['INTERESTED', 'QUALIFIED', 'QUOTE_REQUESTED', 'QUOTE_SENT', 'AWAITING_DECISION', 'NEGOTIATION', 'PAYMENT_COMMITMENT', 'WON', 'LOST', 'PAUSED']),
  NEGOTIATION: new Set(['PAYMENT_COMMITMENT', 'FOLLOW_UP', 'WON', 'LOST', 'PAUSED']),
  WON: new Set([]),
  LOST: new Set(['INTERESTED', 'FOLLOW_UP']),
  PAUSED: new Set(['INTERESTED', 'QUALIFIED', 'QUOTE_REQUESTED', 'QUOTE_SENT', 'AWAITING_DECISION', 'FOLLOW_UP', 'NEGOTIATION', 'PAYMENT_COMMITMENT', 'LOST'])
});

function normalizeState(value, fallback = 'NEW') {
  const normalized = String(value || '').trim().toUpperCase();
  return COMMERCIAL_STATES.includes(normalized) ? normalized : fallback;
}

function canTransition(from, to) {
  const current = normalizeState(from);
  const target = normalizeState(to);
  return current === target || TRANSITIONS[current].has(target);
}

function transitionCommercialState({ from, to, reason = null, now = new Date() }) {
  const current = normalizeState(from);
  const target = normalizeState(to);

  if (!canTransition(current, target)) {
    const error = new Error(`COMMERCIAL_STATE_TRANSITION_INVALID:${current}->${target}`);
    error.code = 'COMMERCIAL_STATE_TRANSITION_INVALID';
    error.from = current;
    error.to = target;
    throw error;
  }

  return Object.freeze({
    previousState: current,
    state: target,
    changed: current !== target,
    reason: reason || null,
    terminal: TERMINAL_STATES.has(target),
    changedAt: now.toISOString()
  });
}

module.exports = {
  COMMERCIAL_STATES,
  TERMINAL_STATES,
  canTransition,
  normalizeState,
  transitionCommercialState
};
