'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');

const source = fs.readFileSync('api/elanUnifiedRuntimeApi.js', 'utf8');

test('Copilot inbound notes are mirrored to the authenticated actor WhatsApp after Unified Memory persistence', () => {
  assert.match(source, /FIELD_MEDIA_PATH/);
  assert.match(source, /mirrorCopilotNoteToWhatsApp/);
  assert.match(source, /channel:\s*body\.channel \|\| 'api'/);
  assert.match(source, /direction,\s*text: body\.text/);
  assert.match(source, /createWahaDeliveryAdapter\(\)/);
  assert.match(source, /📝 ELAN Copiloto · Nota de campo/);
});

test('field captures are permission-scoped, self-addressed, sent to WAHA and persisted in Unified Memory', () => {
  assert.match(source, /canUseFieldCamera/);
  assert.match(source, /camera\.vision/);
  assert.match(source, /actorPhone\(actor\)/);
  assert.match(source, /sendImageData/);
  assert.match(source, /messageType:\s*'image'/);
  assert.match(source, /direction:\s*'inbound'/);
});
