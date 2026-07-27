'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  generateOwnerPresentationAudio,
  isOwnerPhone,
  isOwnerPresentationDemoRequest
} = require('../services/ownerPresentationAudioService');

test('detecta solicitudes Owner de muestra de presentación', () => {
  assert.equal(
    isOwnerPresentationDemoRequest('Enviame una muestra del audio de presentación'),
    true
  );
  assert.equal(
    isOwnerPresentationDemoRequest('/demo bienvenida'),
    true
  );
  assert.equal(
    isOwnerPresentationDemoRequest('estado del sistema'),
    false
  );
});

test('reconoce únicamente teléfonos Owner configurados', () => {
  const previous = process.env.ORCHESTRATOR_OWNER_PHONES;
  process.env.ORCHESTRATOR_OWNER_PHONES = '50588388940';

  try {
    assert.equal(isOwnerPhone('50588388940@c.us'), true);
    assert.equal(isOwnerPhone('50584817885@c.us'), false);
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONES;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONES = previous;
    }
  }
});

test('genera audio OPUS en base64 usando OpenAI', async () => {
  const calls = [];
  const openaiClient = {
    audio: {
      speech: {
        async create(input) {
          calls.push(input);
          return {
            async arrayBuffer() {
              return Buffer.from('audio-demo');
            }
          };
        }
      }
    }
  };

  const audio = await generateOwnerPresentationAudio({
    text: 'Hola, soy ELAN IA.',
    openaiClient
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].response_format, 'opus');
  assert.equal(calls[0].input, 'Hola, soy ELAN IA.');
  assert.equal(audio.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(audio.data, Buffer.from('audio-demo').toString('base64'));
});
