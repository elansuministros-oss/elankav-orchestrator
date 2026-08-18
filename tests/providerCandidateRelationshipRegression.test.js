'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANDIDATE_OUTREACH_CAPABILITY,
  buildProviderCandidateInstructions,
  findLatestProviderCandidate,
  resolveProviderCandidateRelationship
} = require('../services/providerCandidateRelationshipService');
const {
  candidateDecision,
  isRegisteredProviderMessage
} = require('../services/providerCandidateRelationshipPatch');

function job({ phone = '50586088087', name = 'Rumbitos Express', createdAt = '2026-08-18T20:00:00.000Z' } = {}) {
  return {
    status: 'completed',
    createdAt,
    result: {
      audit: {
        capability: CANDIDATE_OUTREACH_CAPABILITY,
        success: true,
        createdAt,
        metadata: {
          relationshipType: 'provider_candidate',
          stage: 'evaluation',
          name,
          phone,
          serviceHint: 'Gypsum, DensGlass',
          objective: 'evaluar proyectos en conjunto'
        }
      }
    }
  };
}

test('PROVIDER-CANDIDATE-REGRESSION-01 resuelve relación por el mismo WhatsApp', async () => {
  const candidate = await resolveProviderCandidateRelationship(
    { phone: '+505 8608 8087', now: Date.parse('2026-08-18T21:00:00.000Z') },
    { listJobsImpl: async () => [job()] }
  );

  assert.equal(candidate?.relationshipType, 'provider_candidate');
  assert.equal(candidate?.phone, '50586088087');
  assert.equal(candidate?.name, 'Rumbitos Express');
});

test('PROVIDER-CANDIDATE-REGRESSION-01 usa el outreach más reciente', () => {
  const older = job({ name: 'Rumbitos anterior', createdAt: '2026-08-17T20:00:00.000Z' });
  const newer = job({ name: 'Rumbitos Express', createdAt: '2026-08-18T20:00:00.000Z' });
  const candidate = findLatestProviderCandidate([older, newer], {
    phone: '86088087',
    now: Date.parse('2026-08-18T21:00:00.000Z')
  });

  assert.equal(candidate?.name, 'Rumbitos Express');
});

test('PROVIDER-CANDIDATE-REGRESSION-01 decisión bloquea bienvenida y prospecto', () => {
  const candidate = findLatestProviderCandidate([job()], {
    phone: '50586088087',
    now: Date.parse('2026-08-18T21:00:00.000Z')
  });
  const memory = {
    conversationId: 'memory-1',
    history: [
      { role: 'assistant', content: '¿Qué servicios realizan?' },
      { role: 'user', content: 'Cobramos por metro cuadrado.' }
    ]
  };
  const decision = candidateDecision(candidate, memory, 'ELANVISUAL');

  assert.equal(decision.relationshipType, 'provider_candidate');
  assert.equal(decision.prospect, null);
  assert.equal(decision.welcome.send, false);
  assert.equal(decision.history.length, 2);
  assert.match(decision.instructions, /No lo trates como cliente, lead o prospecto/i);
  assert.match(decision.instructions, /cobra por m², por proyecto, por jornada/i);
});

test('PROVIDER-CANDIDATE-REGRESSION-01 instrucciones convierten forma de cobro en inteligencia de proveedor', () => {
  const instructions = buildProviderCandidateInstructions({
    name: 'Rumbitos Express',
    phone: '50586088087',
    serviceHint: 'Gypsum, DensGlass',
    objective: 'evaluar proyectos en conjunto'
  });

  assert.match(instructions, /PROVIDER_CANDIDATE/);
  assert.match(instructions, /qué servicios ofrece/i);
  assert.match(instructions, /modalidad de cotización/i);
  assert.match(instructions, /No lo conviertas en proveedor oficial/i);
});

test('PROVIDER-CANDIDATE-REGRESSION-01 proveedor registrado conserva prioridad', () => {
  assert.equal(isRegisteredProviderMessage('[PROVEEDOR REGISTRADO: PLAY MARKETING] Hola'), true);
  assert.equal(isRegisteredProviderMessage('Hola, somos Rumbitos Express'), false);
});
