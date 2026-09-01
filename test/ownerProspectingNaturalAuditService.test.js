'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMAND_TYPE,
  detectOwnerProspectingNaturalAudit,
  executeOwnerProspectingNaturalAudit,
  formatAudit
} = require('../services/ownerProspectingNaturalAuditService');

function audit(overrides = {}) {
  return {
    mission: {
      id: '4835881b-736d-4b2c-b360-d06dc9c5a7ec',
      status: 'running',
      targetCompanies: 500,
      companiesFound: 194,
      contactsFound: 418,
      decisionMakersFound: 60,
      sourcesFound: 2621,
      companiesWithoutDecision: 164,
      readyForContact: 30,
      decisionSearchPending: 156,
      decisionSearchExhausted: 8,
      errorsCount: 0,
      lastError: null,
      updatedAt: '2026-09-01T19:12:25.000Z',
      lastValidationAt: '2026-09-01T19:12:25.000Z'
    },
    outreach: {
      campaigns: 1,
      totalSent: 20,
      emailsSent: 15,
      whatsappSent: 5,
      contactedCompanies: 18,
      responses: 4,
      responseRatePct: 22.2,
      emailResponses: 3,
      whatsappResponses: 1,
      pendingFollowups: 6,
      followupsSent: 2,
      failed: 1,
      skipped: 0,
      blocked: 0,
      queued: 7,
      negativeSignals: 1,
      positiveSignals: 2,
      latestResponses: [{
        prospectId: 'p1',
        companyName: 'Hotel Ejemplo',
        channel: 'email',
        responseSummary: 'Pidieron propuesta y contacto con Mercadeo.',
        messageExcerpt: null,
        occurredAt: '2026-09-01T18:00:00.000Z',
        negativeSignal: false,
        positiveSignal: true
      }]
    },
    attribution: {
      scope: 'prospecting_events_only',
      externalInboundAttributionComplete: false
    },
    generatedAt: '2026-09-01T19:13:00.000Z',
    ...overrides
  };
}

test('detecta preguntas naturales sin exigir la palabra Prospecting', () => {
  const cases = [
    ['ELAN, cuántas empresas encontraste', 'research'],
    ['elan a cuantos le enviaste correo', 'email'],
    ['y por whatsapp a cuantos?', 'whatsapp'],
    ['a cuantos le enviaste correo o wqasap', 'overview'],
    ['contame que te han dicho, hay alguna respuesta', 'responses'],
    ['a quienes les estas dando seguimiento', 'followup'],
    ['ninguno se ha molestado pensando que eres spam?', 'complaints'],
    ['que podemos hacer para mejorar', 'improve'],
    ['hay alguien interesado?', 'interest'],
    ['como va todo con las empresas', 'overview']
  ];

  for (const [message, intent] of cases) {
    const detected = detectOwnerProspectingNaturalAudit(message);
    assert.ok(detected, message);
    assert.equal(detected.type, COMMAND_TYPE);
    assert.equal(detected.input.intent, intent, message);
  }
});

test('no confunde una orden de creación de misión con auditoría', () => {
  assert.equal(
    detectOwnerProspectingNaturalAudit(
      'Buscar 500 empresas con presencia física en Nicaragua y localizar decisores de Mercadeo'
    ),
    null
  );
});

test('responde la investigación con números canónicos y lenguaje natural', async () => {
  const command = detectOwnerProspectingNaturalAudit('ELAN cuantas empresas encontraste');
  const calls = [];
  const result = await executeOwnerProspectingNaturalAudit(command, {
    requestImpl: async (path, options) => {
      calls.push({ path, options });
      return audit();
    }
  });

  assert.equal(result.handled, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, '/api/v1/prospecting/audit');
  assert.match(result.outputText, /194 de 500 empresas/);
  assert.match(result.outputText, /418 contactos/);
  assert.match(result.outputText, /60 decisores/);
  assert.match(result.outputText, /30 empresas listas/);
});

test('responde envíos y respuestas sin inventar cobertura de inbound', () => {
  const email = formatAudit(audit(), 'email');
  assert.match(email, /15 correo/);
  assert.match(email, /3 respuesta/);
  assert.match(email, /no hayan sido atribuidas automáticamente/i);

  const whatsapp = formatAudit(audit(), 'whatsapp');
  assert.match(whatsapp, /5 WhatsApp/);
  assert.match(whatsapp, /1 respuesta/);

  const responses = formatAudit(audit(), 'responses');
  assert.match(responses, /4 empresa\(s\) con respuesta registrada/);
  assert.match(responses, /Hotel Ejemplo/);
  assert.match(responses, /Pidieron propuesta/);
});

test('detecta señales de molestia e interés sin afirmar más de lo registrado', () => {
  const complaints = formatAudit(audit(), 'complaints');
  assert.match(complaints, /1 respuesta\(s\) con señales de molestia/i);

  const interest = formatAudit(audit(), 'interest');
  assert.match(interest, /2 respuesta\(s\) con señales positivas/i);
});

test('propone mejoras a partir de métricas reales y la brecha de atribución', () => {
  const output = formatAudit(audit(), 'improve');
  assert.match(output, /164 empresas sin un decisor utilizable/);
  assert.match(output, /12 empresas listas que todavía no tienen un contacto enviado/);
  assert.match(output, /22\.2%/);
  assert.match(output, /atribución automática de respuestas entrantes/i);
});

test('si no hay misión activa no inventa datos', () => {
  assert.equal(
    formatAudit({ mission: null, outreach: {}, attribution: {} }, 'overview'),
    'Todavía no tengo una investigación comercial activa para ELANVISUAL.'
  );
});
