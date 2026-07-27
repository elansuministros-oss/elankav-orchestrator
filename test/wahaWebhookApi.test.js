const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  classifySource,
  extractIncoming,
  extractMessageType,
  handleWahaWebhookApi,
  normalizePhone,
  resolvePlatformHint
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

test('extractIncoming accepts WAHA message payload', () => {
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
  assert.equal(incoming.sourceOrigin, 'organic_whatsapp');
  assert.equal(incoming.fromMe, false);
});

test('detecta un audio PTT aunque no tenga texto', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      from: '50584817885@c.us',
      type: 'ptt',
      body: ''
    }
  });

  assert.equal(incoming.messageType, 'audio');
  assert.equal(incoming.phone, '50584817885');
  assert.equal(incoming.sourceOrigin, 'organic_whatsapp');
});

test('detecta referencia de Facebook Ads y ELANVISUAL', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      from: '50584817885@c.us',
      type: 'chat',
      body: 'Quiero información',
      _data: {
        referral: {
          sourceUrl: 'https://www.facebook.com/ads/example',
          sourceId: '120000000001',
          sourceType: 'ad',
          headline: 'Caja de luz para tu negocio',
          body: 'Rótulos y fachadas ACM'
        }
      }
    }
  });

  assert.equal(incoming.messageType, 'text');
  assert.equal(incoming.sourceOrigin, 'facebook_ads');
  assert.equal(incoming.platformHint, 'elanvisual');
  assert.equal(incoming.referral.sourceId, '120000000001');
});

test('detecta Instagram Ads', () => {
  assert.equal(classifySource({
    sourceUrl: 'https://www.instagram.com/p/example',
    sourceType: 'ad'
  }), 'instagram_ads');
});

test('resuelve ELANHOME y ELANPET por señales de intención', () => {
  assert.equal(resolvePlatformHint({ text: 'Busco una casa en venta' }), 'elanhome');
  assert.equal(resolvePlatformHint({ text: 'Necesito productos para mi perro' }), 'elanpet');
});

test('no fuerza una plataforma cuando no existen señales', () => {
  assert.equal(resolvePlatformHint({ text: 'Hola, necesito información' }), null);
  assert.equal(extractMessageType({ type: 'document' }), 'document');
});

test('GET /webhook/inbound reports READY', async () => {
  const req = createRequest({ method: 'GET', body: null });
  const res = createResponse();
  const recorder = createSendJsonRecorder();

  const handled = await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson
  });

  assert.equal(handled, true);
  assert.equal(recorder.calls[0].status, 200);
  assert.equal(recorder.calls[0].payload.status, 'READY');
});

test('POST /webhook/inbound processes and sends owner reply', async () => {
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
          context: {
            ownerMode: true,
            platform: 'elanvisual'
          }
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
  assert.equal(processed[0].platform, undefined);
  assert.equal(processed[0].metadata.messageType, 'text');
  assert.equal(processed[0].metadata.sourceOrigin, 'organic_whatsapp');
  assert.deepEqual(sent[0], {
    session: 'default',
    chatId: '50588388940@c.us',
    text: 'Todo operativo.'
  });
  assert.equal(recorder.calls[0].status, 200);
  assert.equal(recorder.calls[0].payload.processed, true);
  assert.equal(recorder.calls[0].payload.replySent, true);
  assert.equal(recorder.calls[0].payload.ownerMode, true);
  assert.equal(recorder.calls[0].payload.messageType, 'text');
});

test('POST /webhook/inbound procesa audio sin texto', async () => {
  const req = createRequest({
    body: {
      event: 'message',
      session: 'ELANKAV',
      payload: {
        from: '50584817885@c.us',
        type: 'ptt',
        body: '',
        fromMe: false
      }
    }
  });
  const res = createResponse();
  const recorder = createSendJsonRecorder();
  const processed = [];

  await handleWahaWebhookApi({
    req,
    res,
    sendJson: recorder.sendJson,
    dependencies: {
      async processMessage(input) {
        processed.push(input);
        return { reply: 'Recibí tu audio.', context: {} };
      },
      async sendWahaText() {
        return { id: 'audio-test-reply' };
      }
    }
  });

  assert.equal(processed.length, 1);
  assert.equal(processed[0].message, '[audio recibido por WhatsApp]');
  assert.equal(processed[0].metadata.messageType, 'audio');
  assert.equal(recorder.calls[0].payload.processed, true);
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
      processMessage: async () => {
        throw new Error('should not run');
      },
      sendWahaText: async () => {
        throw new Error('should not run');
      }
    }
  });

  assert.equal(recorder.calls[0].payload.ignored, true);
  assert.equal(recorder.calls[0].payload.reason, 'FROM_ME');
});
