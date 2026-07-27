'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  handleWahaWebhookAudioDemoApi,
  shouldHandleOwnerAudioDemo
} = require('../api/wahaWebhookAudioDemoApi');

function createRequest(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.url = '/webhook/inbound';
  req.headers = { host: 'localhost' };
  req.destroy = () => {};

  process.nextTick(() => {
    req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });

  return req;
}

function createResponse() {
  return {
    setHeader() {}
  };
}

test('identifica una solicitud válida del Owner', () => {
  const previous = process.env.ORCHESTRATOR_OWNER_PHONES;
  process.env.ORCHESTRATOR_OWNER_PHONES = '50588388940';

  try {
    assert.equal(shouldHandleOwnerAudioDemo({
      phone: '50588388940',
      text: 'Enviame una muestra del audio de presentación',
      chatId: '50588388940@c.us',
      fromMe: false,
      isGroup: false,
      isBroadcast: false
    }), true);
  } finally {
    if (previous === undefined) delete process.env.ORCHESTRATOR_OWNER_PHONES;
    else process.env.ORCHESTRATOR_OWNER_PHONES = previous;
  }
});

test('envía la presentación como mensaje de voz al Owner', async () => {
  const previous = process.env.ORCHESTRATOR_OWNER_PHONES;
  process.env.ORCHESTRATOR_OWNER_PHONES = '50588388940';

  const responses = [];
  const voiceCalls = [];
  const audio = {
    data: Buffer.from('voice').toString('base64'),
    mimetype: 'audio/ogg; codecs=opus',
    filename: 'elan-ia-presentacion.opus'
  };

  try {
    const handled = await handleWahaWebhookAudioDemoApi({
      req: createRequest({
        event: 'message',
        session: 'ELANKAV',
        payload: {
          from: '50588388940@c.us',
          body: 'Enviame una muestra del audio de presentación',
          fromMe: false
        }
      }),
      res: createResponse(),
      sendJson(res, status, payload) {
        responses.push({ status, payload });
      },
      dependencies: {
        async generateOwnerPresentationAudio() {
          return audio;
        },
        async sendWahaVoice(input) {
          voiceCalls.push(input);
          return { id: 'voice-message-id' };
        }
      }
    });

    assert.equal(handled, true);
    assert.equal(voiceCalls.length, 1);
    assert.equal(voiceCalls[0].session, 'ELANKAV');
    assert.equal(voiceCalls[0].chatId, '50588388940@c.us');
    assert.deepEqual(voiceCalls[0].audio, audio);
    assert.equal(responses[0].status, 200);
    assert.equal(responses[0].payload.replyType, 'voice');
    assert.equal(responses[0].payload.ownerMode, true);
    assert.equal(responses[0].payload.action, 'OWNER_PRESENTATION_AUDIO_DEMO');
  } finally {
    if (previous === undefined) delete process.env.ORCHESTRATOR_OWNER_PHONES;
    else process.env.ORCHESTRATOR_OWNER_PHONES = previous;
  }
});
