const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  extractIncoming,
  handleWahaWebhookApi,
  isPresentationAudioRequest,
  normalizePhone
} = require('../api/wahaWebhookApi');

function createRequest({ method = 'POST', url = '/webhook/inbound', body = null } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost' };
  req.destroy = () => {};

  process.nextTick(() => {
    if (body !== null) req.emit('data', Buffer.from(JSON.stringify(body)));
    req.emit('end');
  });

  return req;
}

function createResponse() {
  return {
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value;
    }
  };
}

function createSendJsonRecorder() {
  const calls = [];
  return {
    calls,
    sendJson(res, status, payload) {
      calls.push({ res, status, payload });
    }
  };
}

test('normalizePhone preserves international owner phone', () => {
  assert.equal(normalizePhone('50588388940@c.us'), '50588388940');
});

test('detecta solicitud de muestra de audio', () => {
  assert.equal(isPresentationAudioRequest('Enviame una muestra del audio de presentación'), true);
  assert.equal(isPresentationAudioRequest('/demo bienvenida'), true);
  assert.equal(isPresentationAudioRequest('estado del sistema'), false);
});

test('extractIncoming accepts WAHA text payload', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'default',
    payload: {
      from: '50588388940@c.us',
      body: 'hola',
      fromMe: false
    }
  });

  assert.equal(incoming.event, 'message');
  assert.equal(incoming.chatId, '50588388940@c.us');
  assert.equal(incoming.senderRaw, '50588388940@c.us');
  assert.equal(incoming.phone, '50588388940');
  assert.equal(incoming.text, 'hola');
  assert.equal(incoming.messageType, 'text');
  assert.equal(incoming.fromMe, false);
});

test('extractIncoming preserves WAHA audio media', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      from: '50584817885@c.us',
      type: 'ptt',
      body: '',
      hasMedia: true,
      media: {
        url: 'http://localhost:3000/api/files/voice.ogg',
        mimetype: 'audio/ogg; codecs=opus',
        filename: 'voice.ogg'
      }
    }
  });

  assert.equal(incoming.messageType, 'audio');
  assert.equal(incoming.media.url, 'http://localhost:3000/api/files/voice.ogg');
  assert.equal(incoming.media.filename, 'voice.ogg');
});

test('GET /webhook/inbound reports READY', async () => {
  const req = createRequest({ method: 'GET', body: null });
  const res = createResponse();
  const recorder = createSendJsonRecorder();

  const handled = await handleWahaWebhookApi({ req, res, sendJson: recorder.sendJson });

  assert.equal(handled, true);
  assert.equal(recorder.calls[0].status, 200);
  assert.equal(recorder.calls[0].payload.status, 'READY');
});

test('POST /webhook/inbound processes and sends owner text reply', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      session: 'default',
      payload: {
        from: '50588388940@c.us',
        body: 'estado del sistema',
        fromMe: false
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const processed = [];
  const sent = [];

  const handled = await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async processMessage(input) {
        processed.push(input);
        return {
          reply: 'Todo operativo.',
          model: 'elankav-owner-command',
          context: { ownerMode: true, platform: 'ELANVISUAL' }
        };
      },
      async sendWahaText(input) {
        sent.push(input);
        return { id: 'message-id' };
      }
    }
  });

  assert.equal(handled, true);
  assert.equal(processed.length, 1);
  assert.equal(processed[0].externalUserId, '50588388940@c.us');
  assert.equal(processed[0].phone, '50588388940');
  assert.equal(processed[0].channel, 'whatsapp');
  assert.deepEqual(sent[0], {
    session: 'default',
    chatId: '50588388940@c.us',
    text: 'Todo operativo.'
  });
  assert.equal(recorder.calls[0].payload.replyType, 'text');
  assert.equal(recorder.calls[0].payload.ownerMode, true);
});

test('procesa nota de voz, transcribe y responde con voz', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      session: 'ELANKAV',
      payload: {
        from: '50584817885@c.us',
        type: 'ptt',
        body: '',
        fromMe: false,
        media: {
          url: 'http://localhost:3000/api/files/voice.ogg',
          mimetype: 'audio/ogg; codecs=opus',
          filename: 'voice.ogg'
        }
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const processed = [];
  const voices = [];

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async downloadWahaMedia() {
        return { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' };
      },
      async transcribeAudio() {
        return 'Necesito una cotización para un rótulo';
      },
      async processMessage(input) {
        processed.push(input);
        return { reply: 'Claro. ¿Qué medida necesitás?', context: { ownerMode: false } };
      },
      async synthesizeSpeech({ text }) {
        assert.equal(text, 'Claro. ¿Qué medida necesitás?');
        return { data: 'b3B1cw==', mimeType: 'audio/ogg; codecs=opus' };
      },
      async sendWahaVoice(input) {
        voices.push(input);
        return { id: 'voice-reply' };
      }
    }
  });

  assert.equal(processed[0].message, 'Necesito una cotización para un rótulo');
  assert.equal(processed[0].metadata.transcribedText, 'Necesito una cotización para un rótulo');
  assert.equal(voices.length, 1);
  assert.equal(voices[0].chatId, '50584817885@c.us');
  assert.equal(recorder.calls[0].payload.replyType, 'voice');
  assert.equal(recorder.calls[0].payload.transcribed, true);
});

test('Owner puede solicitar muestra de presentación sin pasar por el modelo', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      session: 'ELANKAV',
      payload: {
        from: '50588388940@c.us',
        body: 'Enviame una muestra del audio de presentación',
        fromMe: false
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const voices = [];

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async processMessage() {
        throw new Error('El modelo no debe ejecutarse');
      },
      async synthesizeSpeech() {
        return { data: 'b3B1cw==', mimeType: 'audio/ogg; codecs=opus' };
      },
      async sendWahaVoice(input) {
        voices.push(input);
      }
    }
  });

  assert.equal(voices.length, 1);
  assert.equal(recorder.calls[0].payload.presentationDemo, true);
  assert.equal(recorder.calls[0].payload.replyType, 'voice');
});

test('POST /webhook/inbound ignores messages sent by the bot', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      payload: {
        from: '50588388940@c.us',
        body: 'hola',
        fromMe: true
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      processMessage: async () => { throw new Error('should not run'); },
      sendWahaText: async () => { throw new Error('should not run'); }
    }
  });

  assert.equal(recorder.calls[0].payload.ignored, true);
  assert.equal(recorder.calls[0].payload.reason, 'FROM_ME');
});
