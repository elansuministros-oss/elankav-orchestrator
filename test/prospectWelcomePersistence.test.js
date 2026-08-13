'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  clearWahaInboundDedupe,
  extractIncoming,
  handleWahaWebhookApi,
  normalizePhone
} = require('../api/wahaWebhookApi');

function request(body) {
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

function response() {
  return { setHeader() {} };
}

function recorder() {
  const calls = [];
  return {
    calls,
    sendJson(res, status, payload) {
      calls.push({ status, payload });
    }
  };
}

test.beforeEach(() => clearWahaInboundDedupe());

test('LID se conserva como identidad y nunca se convierte en teléfono', () => {
  const incoming = extractIncoming({
    event: 'message',
    session: 'ELANKAV',
    payload: {
      from: '168534952960065@lid',
      pushname: 'V.I.C.A❤',
      body: 'Hola',
      fromMe: false
    }
  });

  assert.equal(normalizePhone('168534952960065@lid'), '');
  assert.equal(incoming.senderRaw, '168534952960065@lid');
  assert.equal(incoming.chatId, '168534952960065@lid');
  assert.equal(incoming.phone, '');
  assert.equal(incoming.whatsappName, 'V.I.C.A❤');
});

test('responsesEnabled apagado impide bienvenida, texto y audio', async () => {
  const output = recorder();
  let claims = 0;
  let texts = 0;
  let voices = 0;
  let modelCalls = 0;

  await handleWahaWebhookApi({
    req: request({
      event: 'message',
      id: 'off-1',
      session: 'ELANKAV',
      payload: {
        from: '168534952960065@lid',
        pushname: 'V.I.C.A❤',
        body: 'Hola',
        fromMe: false
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async persistConversationEvent() {
        return { ok: true };
      },
      async requestConversationDecision() {
        claims += 1;
        return { action: 'PAUSED', welcome: { send: false, text: '' } };
      },
      async processMessage() {
        modelCalls += 1;
        return { reply: 'No debe enviarse' };
      },
      async sendWahaText() {
        texts += 1;
      },
      async sendWahaVoice() {
        voices += 1;
      }
    }
  });

  assert.equal(claims, 1);
  assert.equal(modelCalls, 0);
  assert.equal(texts, 0);
  assert.equal(voices, 0);
  assert.equal(output.calls[0].payload.suppressed, true);
  assert.equal(output.calls[0].payload.reason, 'automation_disabled');
});

test('bienvenida se envía únicamente cuando CONNECT concede el reclamo', async () => {
  let claimCalls = 0;
  let welcomeVoices = 0;
  let normalTexts = 0;

  const dependencies = {
    async persistConversationEvent() {
      return { ok: true };
    },
    async requestConversationDecision() {
      claimCalls += 1;
      return { action: 'RESPOND', welcome: { send: claimCalls === 1, text: 'Bienvenida publicada desde CONNECT' } };
    },
    async processMessage() {
      return {
        reply: '¿Cuál es tu nombre y el nombre de tu negocio?',
        context: { ownerMode: false, platform: 'ELANVISUAL' }
      };
    },
    async synthesizeSpeech() {
      return { data: 'b3B1cw==', mimeType: 'audio/ogg' };
    },
    async sendWahaVoice() {
      welcomeVoices += 1;
      return { id: 'welcome-' + welcomeVoices };
    },
    async sendWahaText() {
      normalTexts += 1;
      return { id: 'text-' + normalTexts };
    }
  };

  for (const id of ['welcome-first', 'welcome-second']) {
    const output = recorder();
    await handleWahaWebhookApi({
      req: request({
        event: 'message',
        id,
        session: 'ELANKAV',
        payload: {
          from: '168534952960065@lid',
          pushname: 'V.I.C.A❤',
          body: 'Hola',
          fromMe: false
        }
      }),
      res: response(),
      sendJson: output.sendJson,
      dependencies
    });
    assert.equal(output.calls[0].payload.replySent, true);
  }

  assert.equal(claimCalls, 2);
  assert.equal(welcomeVoices, 1);
  assert.equal(normalTexts, 2);
});

test('pushname se entrega a CONNECT y el teléfono queda vacío para LID', async () => {
  const persisted = [];
  const output = recorder();

  await handleWahaWebhookApi({
    req: request({
      event: 'message',
      id: 'lid-name-1',
      session: 'ELANKAV',
      payload: {
        from: '168534952960065@lid',
        pushname: 'V.I.C.A❤',
        body: 'Necesito un rótulo',
        fromMe: false
      }
    }),
    res: response(),
    sendJson: output.sendJson,
    dependencies: {
      async persistConversationEvent(event) {
        persisted.push(event);
        return { ok: true };
      },
      async requestConversationDecision() {
        return { action: 'PAUSED', welcome: { send: false, text: '' } };
      },
      async processMessage() {
        throw new Error('No debe ejecutarse');
      }
    }
  });

  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].externalUserId, '168534952960065@lid');
  assert.equal(persisted[0].phone, '');
  assert.equal(persisted[0].whatsappName, 'V.I.C.A❤');
});
