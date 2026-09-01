'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractIncoming } = require('../api/wahaWebhookApi');

test('NOWEB webhook resolves canonical phone from remoteJidAlt while preserving LID', () => {
  const incoming = extractIncoming({
    event: 'message.any',
    session: 'ELANKAV',
    payload: {
      from: '85504611594419@lid',
      body: 'Hola ELAN',
      _data: {
        key: {
          fromMe: false,
          remoteJid: '85504611594419@lid',
          remoteJidAlt: '50582121495@s.whatsapp.net',
          addressingMode: 'lid'
        }
      }
    }
  });

  assert.equal(incoming.senderRaw, '85504611594419@lid');
  assert.equal(incoming.phone, '50582121495');
  assert.ok(incoming.identityCandidates.includes('85504611594419@lid'));
  assert.ok(incoming.identityCandidates.includes('50582121495@s.whatsapp.net'));
});

test('GOWS webhook resolves phone from Info.Sender and keeps SenderAlt LID', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      from: '85504611594419@lid',
      body: 'Hola ELAN',
      _data: {
        Info: {
          Sender: '50582121495@s.whatsapp.net',
          SenderAlt: '85504611594419@lid'
        }
      }
    }
  });

  assert.equal(incoming.phone, '50582121495');
  assert.ok(incoming.identityCandidates.includes('50582121495@s.whatsapp.net'));
  assert.ok(incoming.identityCandidates.includes('85504611594419@lid'));
});

test('LID without trusted alternate identity is never treated as a phone number', () => {
  const incoming = extractIncoming({
    event: 'message',
    payload: {
      from: '85504611594419@lid',
      body: 'Hola'
    }
  });

  assert.equal(incoming.phone, '');
  assert.equal(incoming.senderRaw, '85504611594419@lid');
});
