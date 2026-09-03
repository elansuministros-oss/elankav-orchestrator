'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildContextInstructions } = require('../services/openaiService');

test('prospecto proveedor recibe contexto de seguimiento sin pregunta directa de tipo', () => {
  const instructions = buildContextInstructions({
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    actorIdentity: {
      available: true,
      role: 'prospect',
      commercialRole: 'supplier_prospect',
      registered: true,
      relationshipAuthority: 'prospecting_outreach',
      displayName: 'Proveedor de prueba'
    }
  });

  assert.match(instructions, /prospecto proveedor previamente contactado/i);
  assert.match(instructions, /no lo trates como prospecto cliente/i);
  assert.match(instructions, /no preguntes de forma directa si es cliente o proveedor/i);
});

test('prospecto cliente recibe continuidad comercial y no presentación repetida', () => {
  const instructions = buildContextInstructions({
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    actorIdentity: {
      available: true,
      role: 'prospect',
      commercialRole: 'client_prospect',
      registered: true,
      relationshipAuthority: 'prospecting_outreach'
    }
  });

  assert.match(instructions, /prospecto cliente previamente contactado/i);
  assert.match(instructions, /no repitas la presentación inicial/i);
});

test('prospecto sin clasificación no inventa relación', () => {
  const instructions = buildContextInstructions({
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    actorIdentity: {
      available: true,
      role: 'prospect',
      commercialRole: 'unknown_prospect',
      registered: false
    }
  });

  assert.match(instructions, /no existe evidencia suficiente/i);
  assert.match(instructions, /No inventes esa relación/i);
  assert.match(instructions, /forma natural y no binaria/i);
});
