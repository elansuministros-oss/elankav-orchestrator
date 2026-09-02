'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.CONNECT_VOICE_TOKEN = process.env.CONNECT_VOICE_TOKEN || 'test-connect-voice-token';
process.env.ELANKAV_CONNECT_URL = process.env.ELANKAV_CONNECT_URL || 'https://connect.example.test';

const { synthesizeSpeechOfficial } = require('../services/officialVoicePolicyPatch');

test('official speech policy fails closed when CONNECT Voice is unavailable', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return {
      ok: false,
      status: 404,
      json: async () => ({ error: { code: 'ROUTE_NOT_FOUND' } }),
      headers: { get: () => 'application/json' }
    };
  };

  await assert.rejects(
    () => synthesizeSpeechOfficial({ text: 'Hola', fetchImpl }),
    error => error?.code === 'ROUTE_NOT_FOUND' && error?.status === 404
  );
  assert.equal(calls, 1, 'must not call an alternate speech provider');
});

test('audio first-contact policy suppresses separate automatic welcome', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/liveCopilotMessagePatch.js'), 'utf8');
  assert.match(source, /incoming\?\.messageType !== 'audio'/);
  assert.match(source, /audio_single_reply_policy/);
  assert.match(source, /welcome:\s*\{[\s\S]*send:\s*false/);
});

test('role-first replies satisfy both message and WhatsApp reply contracts', () => {
  const source = fs.readFileSync(path.join(__dirname, '../services/inboundCommercialRoleMessagePatch.js'), 'utf8');
  assert.match(source, /const reply = providerCandidateMessage\(\)/);
  assert.match(source, /const reply = clarificationMessage\(\)/);
  const replyAssignments = source.match(/outputText:\s*reply/g) || [];
  const whatsappReplies = source.match(/\n\s*reply,\n/g) || [];
  assert.equal(replyAssignments.length, 2);
  assert.ok(whatsappReplies.length >= 2);
});
