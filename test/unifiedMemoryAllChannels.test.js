'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('services/messageService.js', 'utf8');
const runtime = fs.readFileSync('services/elanUnifiedRuntimeService.js', 'utf8');

test('WhatsApp text and audio persist through the unified actor memory before OpenAI', () => {
  assert.match(source, /persistUnifiedContext/);
  assert.match(source, /direction:\s*'inbound'/);
  assert.match(source, /messageType:\s*inboundMessageType/);
  assert.match(source, /await persistRequiredUnifiedTurn\([\s\S]*direction:\s*'inbound'[\s\S]*await loadConversationMemory/);
  assert.match(source, /direction:\s*'outbound'/);
  assert.match(source, /ELAN_UNIFIED_MEMORY_REQUIRED/);
});

test('Owner uses the same required unified memory path as every other authorized actor', () => {
  assert.match(source, /if \(ownerMode\) \{[\s\S]*persistRequiredUnifiedTurn/);
  assert.match(source, /actorId:\s*'owner'/);
  assert.match(source, /resolvedContext\?\.owner\?\.isOwner[\s\S]*direction:\s*'outbound'/);
});

test('channel is metadata while the canonical memory key remains actor plus platform', () => {
  assert.match(runtime, /function actorMemoryKey\(actor = \{\}\)/);
  assert.match(runtime, /actorId \|\| resolved\.canonicalPhone \|\| resolved\.phone/);
  assert.match(runtime, /sourceChannel:\s*String\(channel \|\| 'unknown'\)/);
  assert.match(runtime, /platform:\s*String\(platform \|\| 'ELANVISUAL'\)\.toUpperCase\(\)/);
});
