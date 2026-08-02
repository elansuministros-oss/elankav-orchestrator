'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  getHistory,
  appendTurn,
  clearConversation,
  settingsOf
} = require('../services/aiConversationContinuityService');

const identity = { platform: 'elanvisual', externalUserId: '50588887777' };

test('continuidad apagada no guarda historial', () => {
  clearConversation(identity);
  appendTurn(identity, { enabled: false }, 'hola', 'respuesta');
  assert.deepEqual(getHistory(identity, { enabled: false }), []);
  assert.deepEqual(getHistory(identity, { enabled: true }), []);
});

test('guarda turnos separados por plataforma e identidad', () => {
  clearConversation(identity);
  appendTurn(identity, { enabled: true, historyLimit: 12 }, 'hola', 'buenas');
  assert.deepEqual(getHistory(identity, { enabled: true, historyLimit: 12 }), [
    { role: 'user', content: 'hola' },
    { role: 'assistant', content: 'buenas' }
  ]);
  assert.deepEqual(getHistory({ platform: 'elanhome', externalUserId: identity.externalUserId }, { enabled: true }), []);
});

test('respeta limite publicado de historial', () => {
  clearConversation(identity);
  appendTurn(identity, { enabled: true, historyLimit: 2 }, 'uno', 'dos');
  appendTurn(identity, { enabled: true, historyLimit: 2 }, 'tres', 'cuatro');
  assert.deepEqual(getHistory(identity, { enabled: true, historyLimit: 2 }), [
    { role: 'user', content: 'tres' },
    { role: 'assistant', content: 'cuatro' }
  ]);
});

test('normaliza limites de continuidad', () => {
  assert.deepEqual(settingsOf({ enabled: true, historyLimit: 100, ttlMinutes: 1 }), {
    enabled: true,
    historyLimit: 30,
    ttlMinutes: 5
  });
});
