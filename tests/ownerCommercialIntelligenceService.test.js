'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  answerOwnerCommercialQuery,
  deriveFallbackFilters,
  looksLikeCommercialIntelligenceQuery
} = require('../services/ownerCommercialIntelligenceService');
const { generateText } = require('../services/openaiService');
const {
  buildQuery,
  createConnectCommercialIntelligenceAdapter
} = require('../adapters/connectCommercialIntelligenceAdapter');

test('detecta consultas naturales de mensajes, pendientes y rendimiento sin sintaxis rígida', () => {
  assert.equal(looksLikeCommercialIntelligenceQuery('¿Cuántos mensajes recibimos hoy?'), true);
  assert.equal(looksLikeCommercialIntelligenceQuery('qué correos tengo pendientes de responder'), true);
  assert.equal(looksLikeCommercialIntelligenceQuery('quién necesita que lo atienda yo personalmente'), true);
  assert.equal(looksLikeCommercialIntelligenceQuery('cómo va el rendimiento de esta semana'), true);
  assert.equal(looksLikeCommercialIntelligenceQuery('haceme una cotización para Juan'), false);
  assert.equal(looksLikeCommercialIntelligenceQuery('hola elan'), false);
});

test('fallback temporal interpreta hoy en America/Managua y conserva filtro de WhatsApp', () => {
  const now = new Date('2026-09-01T02:30:00.000Z');
  const filters = deriveFallbackFilters('cuántos mensajes recibimos hoy por WhatsApp', now);

  assert.equal(filters.channel, 'whatsapp');
  assert.equal(filters.from, '2026-08-31T06:00:00.000Z');
  assert.equal(filters.to, '2026-09-01T02:30:00.000Z');
});

test('adapter comercial usa solo lectura, token interno y filtros de CONNECT', async () => {
  const calls = [];
  const adapter = createConnectCommercialIntelligenceAdapter({
    env: {
      CONNECT_BASE_URL: 'https://connect.example',
      CONNECT_INTERNAL_API_TOKEN: 'TEST_INTERNAL_TOKEN'
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({
        ok: true,
        summary: { conversations: 2, inboundMessages: 5, outboundMessages: 4 }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  });

  await adapter.getReport({
    from: '2026-08-31T06:00:00.000Z',
    to: '2026-09-01T02:30:00.000Z',
    channel: 'whatsapp'
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/api\/v1\/commercial-intelligence\/report\?/);
  assert.match(calls[0].url, /channel=whatsapp/);
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers['X-Elankav-Internal-Token'], 'TEST_INTERNAL_TOKEN');
  assert.equal(calls[0].init.body, undefined);
  assert.doesNotMatch(JSON.stringify(calls[0]), /POST|PATCH|PUT|DELETE/);

  assert.equal(
    buildQuery({ channel: 'email', businessUnit: 'ELANVISUAL' }),
    '?businessUnit=ELANVISUAL&channel=email'
  );
});

test('si OpenAI no llama herramienta, el fallback consulta reporte real antes de responder', async () => {
  const calls = [];
  const adapter = {
    async getReport(filters) {
      calls.push({ resource: 'report', filters });
      return {
        ok: true,
        range: {
          from: filters.from,
          to: filters.to,
          timezone: 'America/Managua'
        },
        summary: {
          conversations: 4,
          inboundMessages: 9,
          outboundMessages: 7,
          elanResponses: 6,
          humanResponses: 1,
          awaitingUs: 2,
          followUpDue: 1,
          ownerRecommended: 1,
          quotesCreated: 3
        }
      };
    },
    async getBriefing() {
      throw new Error('briefing no esperado');
    }
  };

  const result = await answerOwnerCommercialQuery({
    input: 'ELAN, cuántos mensajes recibimos hoy por WhatsApp',
    now: new Date('2026-09-01T02:30:00.000Z'),
    adapter,
    createToolResponseImpl: async () => ({
      id: 'resp-no-tool',
      model: 'test-model',
      status: 'completed',
      outputText: '',
      output: [],
      usage: null
    })
  });

  assert.equal(result.handled, true);
  assert.equal(result.tool, 'get_commercial_report');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filters.channel, 'whatsapp');
  assert.equal(calls[0].filters.from, '2026-08-31T06:00:00.000Z');
  assert.match(result.outputText, /9 mensajes recibidos/);
  assert.match(result.outputText, /2 requieren respuesta nuestra/);
});

test('tool calling natural consulta briefing y usa su resultado para la respuesta final', async () => {
  const calls = [];
  let round = 0;
  const adapter = {
    async getBriefing(filters) {
      calls.push({ resource: 'briefing', filters });
      return {
        ok: true,
        counts: {
          total: 3,
          awaitingUs: 2,
          awaitingCustomer: 1,
          ownerRecommended: 1,
          highOrUrgent: 1
        },
        text: 'Tenés 3 conversaciones. 2 requieren respuesta nuestra. 1 recomiendo que la atendás personalmente.'
      };
    },
    async getReport() {
      throw new Error('report no esperado');
    }
  };

  const result = await answerOwnerCommercialQuery({
    input: 'qué correos tengo pendientes y cuáles debería atender yo',
    adapter,
    createToolResponseImpl: async request => {
      round += 1;
      if (round === 1) {
        assert.equal(Array.isArray(request.tools), true);
        return {
          id: 'resp-1',
          model: 'test-model',
          status: 'completed',
          outputText: '',
          output: [{
            type: 'function_call',
            call_id: 'call-1',
            name: 'get_commercial_briefing',
            arguments: JSON.stringify({
              channel: 'email'
            })
          }],
          usage: null
        };
      }

      assert.equal(request.previousResponseId, 'resp-1');
      assert.equal(request.input[0].type, 'function_call_output');
      return {
        id: 'resp-2',
        model: 'test-model',
        status: 'completed',
        outputText: 'Tenés 2 correos pendientes; uno conviene que lo atendás personalmente.',
        output: [],
        usage: null
      };
    }
  });

  assert.equal(round, 2);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].filters.channel, 'email');
  assert.equal(result.tool, 'get_commercial_briefing');
  assert.match(result.outputText, /2 correos pendientes/);
});

test('normaliza fechas del modelo y hace prevalecer el período natural del Owner', async () => {
  const calls = [];
  let round = 0;
  const adapter = {
    async getReport(filters) {
      calls.push(filters);
      return {
        ok: true,
        range: { from: filters.from, to: filters.to, timezone: 'America/Managua' },
        summary: {
          conversations: 2,
          inboundMessages: 8,
          outboundMessages: 7,
          elanResponses: 7,
          humanResponses: 0
        }
      };
    },
    async getBriefing() {
      throw new Error('briefing no esperado');
    }
  };

  const result = await answerOwnerCommercialQuery({
    input: 'cómo va el rendimiento de esta semana',
    now: new Date('2026-09-01T03:00:00.000Z'),
    adapter,
    createToolResponseImpl: async request => {
      round += 1;
      if (round === 1) {
        return {
          id: 'week-1',
          model: 'test-model',
          status: 'completed',
          outputText: '',
          output: [{
            type: 'function_call',
            call_id: 'week-call',
            name: 'get_commercial_report',
            arguments: JSON.stringify({
              from: '2026-08-31T00:00:00-06:00',
              to: '2026-09-01T03:00:00Z'
            })
          }],
          usage: null
        };
      }

      return {
        id: 'week-2',
        model: 'test-model',
        status: 'completed',
        outputText: 'Esta semana recibimos 8 mensajes.',
        output: [],
        usage: null
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].from, '2026-08-31T06:00:00.000Z');
  assert.equal(calls[0].to, '2026-09-01T03:00:00.000Z');
  assert.match(result.outputText, /8 mensajes/);
});

test('si briefing filtrado falla, deriva pendientes de email desde reporte real sin inventar', async () => {
  let briefingCalls = 0;
  let reportCalls = 0;
  const adapter = {
    async getBriefing(filters) {
      briefingCalls += 1;
      const error = new Error('No fue posible completar la operación.');
      error.code = 'INTERNAL_ERROR';
      error.status = 500;
      error.filters = filters;
      throw error;
    },
    async getReport(filters) {
      reportCalls += 1;
      assert.deepEqual(filters, {});
      return {
        ok: true,
        range: {
          from: '2026-08-26T00:00:00.000Z',
          to: '2026-09-01T03:00:00.000Z',
          timezone: 'America/Managua'
        },
        summary: {
          conversations: 3,
          inboundMessages: 10,
          outboundMessages: 9
        },
        attention: {
          awaitingUs: [
            {
              conversationId: 'email-1',
              customer: 'Cliente Email',
              channel: 'email',
              businessUnit: 'ELANVISUAL',
              priority: 'normal',
              summary: 'Solicitó una cotización',
              lastMessageAt: '2026-09-01T02:00:00.000Z'
            },
            {
              conversationId: 'wa-1',
              customer: 'Cliente WhatsApp',
              channel: 'whatsapp',
              businessUnit: 'ELANVISUAL',
              priority: 'normal',
              summary: 'Otro caso',
              lastMessageAt: '2026-09-01T02:10:00.000Z'
            }
          ],
          awaitingCustomer: [],
          followUp: [],
          ownerRecommended: [
            {
              conversationId: 'email-1',
              customer: 'Cliente Email',
              channel: 'email',
              businessUnit: 'ELANVISUAL',
              summary: 'Solicitó una cotización',
              lastMessageAt: '2026-09-01T02:00:00.000Z'
            }
          ]
        },
        daily: []
      };
    }
  };

  const result = await answerOwnerCommercialQuery({
    input: 'qué correos tengo pendientes y cuáles debería atender yo personalmente',
    adapter,
    createToolResponseImpl: async () => ({
      id: 'email-tool',
      model: 'test-model',
      status: 'completed',
      outputText: '',
      output: [{
        type: 'function_call',
        call_id: 'email-call',
        name: 'get_commercial_briefing',
        arguments: JSON.stringify({ channel: 'email' })
      }],
      usage: null
    })
  });

  assert.equal(briefingCalls, 2);
  assert.equal(reportCalls, 1);
  assert.equal(result.handled, true);
  assert.equal(result.degraded, true);
  assert.match(result.outputText, /1 correos\/conversaciones por email/);
  assert.match(result.outputText, /Cliente Email/);
  assert.doesNotMatch(result.outputText, /Cliente WhatsApp/);
});

test('si reporte semanal filtrado falla, proyecta el período desde daily del reporte real', async () => {
  let filteredCalls = 0;
  let fullCalls = 0;
  const adapter = {
    async getBriefing() {
      throw new Error('briefing no esperado');
    },
    async getReport(filters) {
      if (Object.keys(filters).length) {
        filteredCalls += 1;
        const error = new Error('No fue posible completar la operación.');
        error.code = 'INTERNAL_ERROR';
        error.status = 500;
        throw error;
      }

      fullCalls += 1;
      return {
        ok: true,
        range: {
          from: '2026-08-26T00:00:00.000Z',
          to: '2026-09-01T03:00:00.000Z',
          timezone: 'America/Managua'
        },
        daily: [
          {
            date: '2026-08-30',
            inboundMessages: 100,
            outboundMessages: 100,
            elanResponses: 100,
            humanResponses: 0,
            quotesCreated: 0,
            quotesAccepted: 0,
            quotesAcceptedValue: 0
          },
          {
            date: '2026-08-31',
            inboundMessages: 20,
            outboundMessages: 18,
            elanResponses: 18,
            humanResponses: 0,
            quotesCreated: 1,
            quotesAccepted: 0,
            quotesAcceptedValue: 0
          }
        ],
        attention: {
          awaitingUs: [],
          followUp: [],
          ownerRecommended: []
        }
      };
    }
  };

  const result = await answerOwnerCommercialQuery({
    input: 'cómo va el rendimiento de esta semana',
    now: new Date('2026-09-01T03:00:00.000Z'),
    adapter,
    createToolResponseImpl: async () => ({
      id: 'week-no-tool',
      model: 'test-model',
      status: 'completed',
      outputText: '',
      output: [],
      usage: null
    })
  });

  assert.equal(filteredCalls, 1);
  assert.equal(fullCalls, 1);
  assert.equal(result.degraded, true);
  assert.match(result.outputText, /20 mensajes recibidos/);
  assert.doesNotMatch(result.outputText, /100 mensajes recibidos/);
});

test('generateText intercepta la consulta Owner antes de la respuesta genérica', async () => {
  let calls = 0;
  const result = await generateText({
    input: 'cuántos mensajes recibimos hoy',
    history: [],
    instructions: 'OWNER TEST',
    context: {
      ownerMode: true,
      ownerName: 'Erick Cano'
    },
    ownerCommercialResponder: async input => {
      calls += 1;
      assert.equal(input.input, 'cuántos mensajes recibimos hoy');
      return {
        handled: true,
        outputText: 'Recibimos 12 mensajes hoy.',
        model: 'owner-commercial-test',
        id: 'commercial-test',
        status: 'completed',
        usage: null,
        tool: 'get_commercial_report'
      };
    }
  });

  assert.equal(calls, 1);
  assert.equal(result.outputText, 'Recibimos 12 mensajes hoy.');
  assert.equal(result.model, 'owner-commercial-test');
  assert.equal(result.commercialIntelligence, true);
  assert.equal(result.commercialTool, 'get_commercial_report');
});
