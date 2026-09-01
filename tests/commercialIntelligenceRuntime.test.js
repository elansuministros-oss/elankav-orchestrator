'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');

const {
  createConnectCommercialIntelligenceAdapter
} = require('../adapters/connectCommercialIntelligenceAdapter');
const {
  commercialRange,
  detectCommercialIntelligenceIntent,
  executeCommercialIntelligenceIntent,
  formatCommercialReport,
  installElanUnifiedRuntimeMessagePatch
} = require('../services/elanUnifiedRuntimeMessagePatch');
const {
  clearWahaInboundDedupe,
  handleWahaWebhookApi
} = require('../api/wahaWebhookApi');

const FIXED_NOW = new Date('2026-09-01T15:30:00.000Z');

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

test.afterEach(() => clearWahaInboundDedupe());

test('detecta consultas naturales de todo el alcance comercial', () => {
  const cases = [
    ['Cuántos mensajes recibimos el día de hoy', 'report', 'today', null],
    ['Dame el resumen comercial de esta semana', 'briefing', 'week', null],
    ['Qué clientes están pendientes de respuesta', 'briefing', 'recent', null],
    ['Quién necesita que lo atienda personalmente', 'briefing', 'recent', null],
    ['Cómo vamos en ventas y cotizaciones hoy', 'report', 'today', null],
    ['Cuántos correos recibimos ayer', 'report', 'yesterday', 'email'],
    ['Mostrame los pendientes de WhatsApp', 'briefing', 'recent', 'whatsapp'],
    ['Qué seguimiento comercial tenemos de ELANPET', 'briefing', 'recent', null]
  ];

  for (const [message, type, period, channel] of cases) {
    const intent = detectCommercialIntelligenceIntent(message, { now: FIXED_NOW });
    assert.ok(intent, message);
    assert.equal(intent.type, type, message);
    assert.equal(intent.period, period, message);
    assert.equal(intent.channel, channel, message);
  }

  assert.equal(
    detectCommercialIntelligenceIntent('Hola, estás ahí', { now: FIXED_NOW }),
    null
  );
});

test('calcula hoy y ayer en zona horaria de Nicaragua', () => {
  assert.deepEqual(commercialRange('today', FIXED_NOW), {
    from: '2026-09-01T06:00:00.000Z',
    to: '2026-09-01T15:30:00.000Z'
  });
  assert.deepEqual(commercialRange('yesterday', FIXED_NOW), {
    from: '2026-08-31T06:00:00.000Z',
    to: '2026-09-01T05:59:59.999Z'
  });
});

test('adapter consulta briefing y reporte con token interno sin exponerlo', async () => {
  const calls = [];
  const adapter = createConnectCommercialIntelligenceAdapter({
    env: {
      CONNECT_BASE_URL: 'https://connect.example',
      CONNECT_INTERNAL_API_TOKEN: 'SECRET_SERVER_TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ ok: true, summary: {} }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }
  });

  await adapter.getReport({ channel: 'email', businessUnit: 'ELANVISUAL' });
  await adapter.getBriefing({ channel: 'whatsapp' });

  assert.match(calls[0].url, /commercial-intelligence\/report/);
  assert.match(calls[0].url, /channel=email/);
  assert.match(calls[0].url, /businessUnit=ELANVISUAL/);
  assert.equal(calls[0].init.headers['X-Elankav-Internal-Token'], 'SECRET_SERVER_TOKEN');
  assert.doesNotMatch(JSON.stringify(await adapter.getReport({})), /SECRET_SERVER_TOKEN/);
  assert.match(calls[1].url, /commercial-intelligence\/briefing/);
});

test('formatea cifras verificadas del reporte completo', () => {
  const text = formatCommercialReport({
    summary: {
      conversations: 8,
      inboundMessages: 14,
      outboundMessages: 10,
      elanResponses: 7,
      humanResponses: 3,
      awaitingUs: 2,
      awaitingCustomer: 4,
      followUpDue: 1,
      ownerRecommended: 1,
      quotesCreated: 3,
      quotesAccepted: 1,
      quotesPending: 2
    }
  }, { period: 'today', channel: null });

  assert.match(text, /Hoy recibimos 14 mensajes en 8 conversaciones/);
  assert.match(text, /2 requieren respuesta nuestra/);
  assert.match(text, /1 recomiendo que las atendás personalmente/);
  assert.match(text, /3 creadas, 1 aceptadas y 2 pendientes/);
});

test('un fallo de CONNECT produce respuesta segura y nunca una cifra inventada', async () => {
  const result = await executeCommercialIntelligenceIntent({
    intent: { type: 'report', period: 'today', filters: {} },
    context: { owner: { isOwner: true }, platform: 'ELANVISUAL', channel: 'whatsapp' },
    args: { message: 'Cuántos mensajes recibimos hoy', phone: '50500000000' },
    adapter: {
      async getReport() {
        const error = new Error('CONNECT caído');
        error.code = 'CONNECT_DOWN';
        throw error;
      }
    }
  });

  assert.match(result.reply, /No pude consultar la inteligencia comercial de CONNECT/);
  assert.match(result.reply, /CONNECT_DOWN/);
  assert.doesNotMatch(result.reply, /recibimos \d+ mensajes/);
});

test('el runtime instalado intercepta la consulta natural antes del fallback antiguo', async () => {
  let fallbackCalls = 0;
  const persisted = [];
  const messageService = {
    async processMessage() {
      fallbackCalls += 1;
      return { reply: 'No tengo ese conteo en contexto.' };
    }
  };

  installElanUnifiedRuntimeMessagePatch(messageService, {
    commercialIntelligenceAdapter: {
      async getReport() {
        return {
          ok: true,
          summary: {
            conversations: 4,
            inboundMessages: 9,
            outboundMessages: 8,
            elanResponses: 8,
            humanResponses: 0,
            awaitingUs: 1,
            awaitingCustomer: 2,
            followUpDue: 0,
            ownerRecommended: 0,
            quotesCreated: 1,
            quotesAccepted: 0,
            quotesPending: 1
          }
        };
      }
    },
    async persistRuntimeTurn(event) {
      persisted.push(event);
      return { ok: true };
    },
    async persistOwnerTurn(event) {
      persisted.push(event);
      return { ok: true };
    }
  });

  const result = await messageService.processMessage({
    message: 'Me puedes decir cuántos mensajes recibimos el día de hoy',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50588388940@c.us',
    phone: '50588388940',
    metadata: { messageId: 'runtime-installed-01' }
  });

  assert.equal(fallbackCalls, 0);
  assert.match(result.reply, /Hoy recibimos 9 mensajes en 4 conversaciones/);
  assert.equal(result.command, 'commercial_intelligence.report');
  assert.equal(persisted.length, 2);
});

test('evento WAHA real consulta CONNECT y envía la respuesta comercial', async () => {
  const sent = [];
  const replies = [];
  const recorder = [];
  const adapter = {
    async getReport(filters) {
      assert.equal(filters.from, '2026-09-01T06:00:00.000Z');
      return {
        ok: true,
        summary: {
          conversations: 6,
          inboundMessages: 11,
          outboundMessages: 9,
          elanResponses: 8,
          humanResponses: 1,
          awaitingUs: 2,
          awaitingCustomer: 3,
          followUpDue: 1,
          ownerRecommended: 1,
          quotesCreated: 2,
          quotesAccepted: 1,
          quotesPending: 1
        }
      };
    }
  };

  await handleWahaWebhookApi({
    req: request({
      event: 'message',
      session: 'ELANKAV',
      payload: {
        id: 'commercial-runtime-e2e-01',
        from: '50588388940@c.us',
        body: 'Me puedes decir cuántos mensajes recibimos el día de hoy',
        fromMe: false
      }
    }),
    res: response(),
    sendJson(_res, status, payload) {
      recorder.push({ status, payload });
    },
    dependencies: {
      async requestConversationDecision() {
        return { action: 'RESPOND', welcome: { send: false, text: '' } };
      },
      async processMessage(input) {
        const intent = detectCommercialIntelligenceIntent(input.message, { now: FIXED_NOW });
        const result = await executeCommercialIntelligenceIntent({
          intent,
          context: { owner: { isOwner: true }, platform: input.platform, channel: input.channel },
          args: input,
          adapter
        });
        replies.push(result.reply);
        return result;
      },
      async sendWahaText(input) {
        sent.push(input);
        return { id: 'commercial-reply-01' };
      },
      async persistConversationEvent() {
        return { ok: true };
      }
    }
  });

  assert.equal(replies.length, 1);
  assert.match(replies[0], /Hoy recibimos 11 mensajes en 6 conversaciones/);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '50588388940@c.us');
  assert.equal(sent[0].text, replies[0]);
  assert.equal(recorder[0].status, 200);
  assert.equal(recorder[0].payload.replySent, true);
});
