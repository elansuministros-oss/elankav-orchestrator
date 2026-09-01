const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  clearWahaInboundDedupe,
  extractIncoming,
  handleWahaWebhookApi,
  isPresentationAudioRequest,
  normalizePhone,
  resolveOwnerIdentityFromIncoming
} = require('../api/wahaWebhookApi');

test.afterEach(() => {
  clearWahaInboundDedupe();
});

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

test('extractIncoming recognizes GOWS audio by media MIME when type is absent', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      id: 'false_215440458567779@lid_ACCE719BB141BBD925FE61ECE50B9299',
      from: '215440458567779@lid',
      fromMe: false,
      hasMedia: true,
      media: {
        url: 'http://localhost:3000/api/files/voice-gows.ogg',
        mimetype: 'audio/ogg; codecs=opus'
      }
    }
  });

  assert.equal(incoming.messageType, 'audio');
  assert.equal(incoming.chatId, '215440458567779@lid');
  assert.equal(incoming.media.url, 'http://localhost:3000/api/files/voice-gows.ogg');
  assert.equal(incoming.media.mimeType, 'audio/ogg; codecs=opus');
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
  const persisted = [];

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
      },
      async persistConversationEvent(input) {
        persisted.push(input);
        return { ok: true };
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
  assert.equal(persisted.length, 2);
  assert.equal(persisted[0].direction, 'inbound');
  assert.equal(persisted[1].direction, 'outbound');
  assert.equal(persisted[1].externalMessageId, 'message-id');
});


test('Owner recibido por @lid responde aunque CONNECT conversation gate esté caído o pausado', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      id: 'owner-lid-regression-01',
      session: 'ELANKAV',
      payload: {
        from: '215440458567779@lid',
        body: 'estado del sistema',
        fromMe: false
      }
    }
  });

  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const processed = [];
  const sent = [];
  let decisionCalls = 0;

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async requestConversationDecision() {
        decisionCalls += 1;
        throw new Error('Owner no debe depender del gate de conversaciones de clientes');
      },

      async processMessage(input) {
        processed.push(input);

        return {
          reply: 'Modo Owner reconocido.',
          model: 'elankav-owner-command',
          context: {
            ownerMode: true,
            platform: 'ELANVISUAL'
          }
        };
      },

      async sendWahaText(input) {
        sent.push(input);
        return { id: 'owner-lid-reply' };
      },

      async persistConversationEvent() {
        return { ok: true };
      }
    }
  });

  assert.equal(decisionCalls, 0);
  assert.equal(processed.length, 1);
  assert.equal(processed[0].externalUserId, '215440458567779@lid');
  assert.equal(sent[0].chatId, '215440458567779@lid');
  assert.equal(recorder.calls[0].payload.ownerMode, true);
  assert.equal(recorder.calls[0].payload.replySent, true);
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

test('POST /webhook/inbound ignora eventos session.status', async () => {
  const req = createRequest({
    body: {
      event: 'session.status',
      session: 'ELANKAV',
      payload: { status: 'WORKING' }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      processMessage: async () => { throw new Error('should not run'); }
    }
  });

  assert.equal(recorder.calls[0].payload.ignored, true);
  assert.equal(recorder.calls[0].payload.reason, 'EVENT_NOT_MESSAGE');
});

test('POST /webhook/inbound ignora grupos', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      payload: {
        from: '120363000000@g.us',
        body: 'hola',
        fromMe: false
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
      processMessage: async () => { throw new Error('should not run'); }
    }
  });

  assert.equal(recorder.calls[0].payload.ignored, true);
  assert.equal(recorder.calls[0].payload.reason, 'GROUP_MESSAGE');
});

test('POST /webhook/inbound deduplica eventos repetidos', async () => {
  const body = {
    event: 'message',
    id: 'event-dupe-1',
    session: 'ELANKAV',
    payload: {
      from: '50584817885@c.us',
      body: 'hola',
      fromMe: false
    }
  };
  const recorder = createSendJsonRecorder();
  let processed = 0;
  const dependencies = {
    async processMessage() {
      processed += 1;
      return { reply: 'respuesta', context: {} };
    },
    async sendWahaText() {}
  };

  await handleWahaWebhookApi({
    req: createRequest({ body }),
    res: createResponse(),
    sendJson: recorder.sendJson,
    dependencies
  });
  await handleWahaWebhookApi({
    req: createRequest({ body }),
    res: createResponse(),
    sendJson: recorder.sendJson,
    dependencies
  });

  assert.equal(processed, 1);
  assert.equal(recorder.calls[1].payload.reason, 'DUPLICATE_MESSAGE');
});

test('POST /webhook/inbound conserva chatId @lid al responder voz', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      id: 'event-lid-voice',
      session: 'ELANKAV',
      payload: {
        from: '168534952960065@lid',
        type: 'audio',
        fromMe: false,
        mediaUrl: '/api/files/voice-lid.ogg',
        mimetype: 'audio/ogg; codecs=opus'
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
      async downloadWahaMedia() {
        return { buffer: Buffer.from('audio'), mimeType: 'application/octet-stream' };
      },
      async transcribeAudio(input) {
        assert.equal(input.mimeType, 'audio/ogg');
        return 'Necesito precio';
      },
      async processMessage(input) {
        assert.equal(input.metadata.chatId, '168534952960065@lid');
        assert.equal(input.metadata.messageId, 'event-lid-voice');
        return { reply: 'Claro.', context: {} };
      },
      async synthesizeSpeech() {
        return { data: 'b3B1cw==', mimeType: 'audio/ogg' };
      },
      async sendWahaVoice(input) {
        voices.push(input);
      }
    }
  });

  assert.equal(voices[0].chatId, '168534952960065@lid');
  assert.equal(recorder.calls[0].payload.replyType, 'voice');
});

test('POST /webhook/inbound falla síntesis y responde el mismo texto', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      id: 'event-speech-fallback',
      payload: {
        from: '50584817885@c.us',
        type: 'ptt',
        fromMe: false,
        mediaUrl: '/api/files/voice.ogg',
        mimetype: 'audio/ogg; codecs=opus'
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const texts = [];

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async downloadWahaMedia() {
        return { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' };
      },
      async transcribeAudio() {
        return 'Mensaje de voz';
      },
      async processMessage() {
        return { reply: 'Respuesta final sin regenerar.', context: {} };
      },
      async synthesizeSpeech() {
        const error = new Error('TTS down');
        error.code = 'VOICE_SPEECH_FAILED';
        throw error;
      },
      async sendWahaText(input) {
        texts.push(input);
      }
    }
  });

  assert.equal(texts[0].text, 'Respuesta final sin regenerar.');
  assert.equal(recorder.calls[0].payload.replyType, 'text');
});

test('POST /webhook/inbound falla transcripción y envía mensaje visible', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      id: 'event-transcription-fallback',
      session: 'ELANKAV',
      payload: {
        from: '50584817885@c.us',
        type: 'audio',
        fromMe: false,
        mediaUrl: '/api/files/bad.ogg',
        mimetype: 'audio/ogg; codecs=opus'
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const texts = [];

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async downloadWahaMedia() {
        return { buffer: Buffer.from('audio'), mimeType: 'audio/ogg' };
      },
      async transcribeAudio() {
        const error = new Error('No audio');
        error.code = 'VOICE_TRANSCRIPTION_EMPTY';
        throw error;
      },
      async processMessage() {
        throw new Error('runtime should not run');
      },
      async sendWahaText(input) {
        texts.push(input);
      }
    }
  });

  assert.equal(texts[0].chatId, '50584817885@c.us');
  assert.equal(texts[0].text, 'No pude escuchar correctamente la nota de voz. Podés enviarla nuevamente o escribirme el mensaje.');
  assert.equal(recorder.calls[0].payload.ok, false);
});


test('WhatsApp Web Owner LID wins over a misleading phone candidate', () => {
  const owner = resolveOwnerIdentityFromIncoming({
    senderRaw: '215440458567779@lid',
    chatId: '215440458567779@lid',
    phone: '50512345678',
    identityCandidates: [
      '50512345678@c.us',
      '215440458567779@lid'
    ]
  });

  assert.equal(owner.isOwner, true);
  assert.equal(owner.phone, '50588388940');
  assert.equal(owner.matchedAlias, true);
});
