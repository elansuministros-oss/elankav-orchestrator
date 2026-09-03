'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const messageService = fs.readFileSync('services/messageService.js', 'utf8');
const openaiService = fs.readFileSync('services/openaiService.js', 'utf8');

test('CONNECT gobierna ON/OFF e instrucciones del cliente en la rama estable', () => {
  assert.match(messageService, /requestConversationDecision/);
  assert.match(messageService, /decision\.action === 'PAUSED'/);
  assert.match(messageService, /instructions: \[decision\.instructions/);
});

test('Orchestrator no inyecta la política conversacional local a clientes', () => {
  assert.match(openaiService, /const conversationPolicy = context\?\.ownerMode === true/);
  assert.match(openaiService, /: '';/);
  assert.match(openaiService, /Customer-facing identity and conversation behavior come from CONNECT/);
});
