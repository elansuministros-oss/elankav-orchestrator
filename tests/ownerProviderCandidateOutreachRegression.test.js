'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildProviderCandidateOpening,
  executeProviderCandidateOutreach,
  parseProviderCandidateOutreach
} = require('../services/ownerProviderCandidateOutreachMessagePatch');

test('OWNER-PROVIDER-CANDIDATE-01 reconoce Rumbitos con número directo', () => {
  const command = parseProviderCandidateOutreach(
    'ELAN, escribile a Rumbitos Express al 8608 8087. Es un posible proveedor de Gypsum y DensGlass; queremos conocer sus servicios, cómo trabajan y cómo cobran.'
  );

  assert.equal(command?.type, 'provider_candidate_outreach');
  assert.equal(command?.relationshipType, 'provider_candidate');
  assert.equal(command?.phone, '50586088087');
  assert.equal(command?.name, 'Rumbitos Express');
  assert.match(command?.serviceHint || '', /Gypsum/i);
  assert.match(command?.serviceHint || '', /DensGlass/i);
});

test('OWNER-PROVIDER-CANDIDATE-01 no captura contacto normal sin intención de proveedor', () => {
  const command = parseProviderCandidateOutreach(
    'ELAN, escribile a Juan al 8608 8087 y decile que llego a las cuatro.'
  );
  assert.equal(command, null);
});

test('OWNER-PROVIDER-CANDIDATE-01 apertura identifica ELAN IA y no vende', () => {
  const text = buildProviderCandidateOpening({
    name: 'Rumbitos Express',
    phone: '50586088087',
    serviceHint: 'Gypsum, DensGlass'
  });

  assert.match(text, /Soy ELAN IA, asistente de Erick Cano en ELANVISUAL/i);
  assert.match(text, /trabajar juntos en algunos proyectos/i);
  assert.match(text, /servicios realizan actualmente/i);
  assert.match(text, /por m², por proyecto, por jornada/i);
  assert.doesNotMatch(text, /¿En qué proyecto visual podemos ayudarte/i);
});

test('OWNER-PROVIDER-CANDIDATE-01 ejecución envía, audita y persiste memoria sin crear proveedor', async () => {
  const calls = { sent: [], audits: [], memory: [] };
  const candidate = {
    relationshipType: 'provider_candidate',
    name: 'Rumbitos Express',
    phone: '50586088087',
    serviceHint: 'Gypsum, DensGlass',
    objective: 'evaluar proyectos en conjunto'
  };

  const result = await executeProviderCandidateOutreach(candidate, {
    delivery: {
      sendText: async input => {
        calls.sent.push(input);
        return { chatId: '50586088087@c.us', messageId: 'msg-1' };
      }
    },
    recordAudit: async input => {
      calls.audits.push(input);
      return { ok: true };
    },
    publishMemory: async input => {
      calls.memory.push(input);
      return { ok: true };
    },
    now: () => '2026-08-18T21:00:00.000Z'
  });

  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].phone, '50586088087');
  assert.equal(calls.audits.length, 1);
  assert.equal(calls.audits[0].capability, 'business.provider-candidate.outreach.send');
  assert.equal(calls.audits[0].metadata.relationshipType, 'provider_candidate');
  assert.equal(calls.audits[0].metadata.stage, 'evaluation');
  assert.equal(calls.memory.length, 1);
  assert.equal(calls.memory[0].actorRole, 'provider_candidate');
  assert.equal(calls.memory[0].direction, 'outbound');
  assert.equal(result.sent.messageId, 'msg-1');
  assert.equal(Object.prototype.hasOwnProperty.call(calls.audits[0].metadata, 'providerId'), false);
});
