'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMERCIAL_CONVERSATION_RULES,
  CONVERSATION_POLICY_VERSION,
  VOICE_PROFILE,
  buildConversationInstructions,
  mergeCommercialState,
  sanitizeStatePatch
} = require('../services/elanConversationPolicyService');

test('official conversation policy preserves OPERADOR_AI-001 rules', () => {
  const text = buildConversationInstructions({ actorRole: 'customer' });
  assert.equal(CONVERSATION_POLICY_VERSION, '1.0.0');
  assert.ok(COMMERCIAL_CONVERSATION_RULES.length >= 10);
  assert.match(text, /vendedor experto/i);
  assert.match(text, /máximo una pregunta/i);
  assert.match(text, /no iniciar cuestionarios largos/i);
  assert.match(text, /no inventar precios/i);
  assert.match(text, /precio, medida o material ya viene verificado/i);
  assert.match(text, /Estado Comercial Persistente/i);
  assert.match(text, /no.*Langflow.*CONNECT/i);
  assert.match(text, /sin inventar datos/i);
  assert.match(text, /aplicarlas? en silencio/i);
  assert.match(text, /¿Qué medidas aproximadas tendrá el rótulo\?/i);
});

test('commercial state patch only accepts the approved structured fields', () => {
  const patch = sanitizeStatePatch({
    platform: 'ELANVISUAL',
    category: 'ROTULACION',
    product: 'JALA_VISTA',
    width: 60,
    height: 40,
    quantity: 1,
    finish: 'LUZ',
    status: 'COTIZANDO',
    arbitrarySecret: 'must drop'
  });

  assert.deepEqual(patch, {
    platform: 'ELANVISUAL',
    category: 'ROTULACION',
    product: 'JALA_VISTA',
    width: 60,
    height: 40,
    quantity: 1,
    finish: 'LUZ',
    status: 'COTIZANDO'
  });

  assert.deepEqual(
    mergeCommercialState(
      { customerReference: 'CLIENTE A', quantity: 1 },
      { quantity: 2, finish: 'SIN LUZ' }
    ),
    { customerReference: 'CLIENTE A', quantity: 2, finish: 'SIN LUZ' }
  );
});

test('VOICE-001 official logical profile remains explicit and provider-independent in Orchestrator', () => {
  assert.equal(VOICE_PROFILE.contract, 'VOICE-001');
  assert.equal(VOICE_PROFILE.profileKey, 'elan-ia-official-v1');
  assert.equal(VOICE_PROFILE.language, 'es-419');
  assert.equal(VOICE_PROFILE.provider, 'openai');
  assert.equal(VOICE_PROFILE.model, 'gpt-4o-mini-tts');
  assert.equal(VOICE_PROFILE.voice, 'cedar');
  assert.equal(VOICE_PROFILE.format, 'opus');
  assert.match(VOICE_PROFILE.identity.tone, /natural/i);
  assert.match(VOICE_PROFILE.identity.tone, /confiable/i);
  assert.match(VOICE_PROFILE.identity.accent, /centroamericana/i);
});
