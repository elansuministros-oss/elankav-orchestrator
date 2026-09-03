'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { actorInstructions } = require('../services/messageService');

test('supplier prospect keeps provider continuity without binary identity question', () => {
  const instructions = actorInstructions({
    role: 'prospect',
    commercialRole: 'supplier_prospect'
  }, { scopes: [] });

  assert.match(instructions, /prospecto proveedor previamente contactado/i);
  assert.match(instructions, /no como prospecto cliente/i);
  assert.match(instructions, /no preguntes de forma directa si es cliente o proveedor/i);
});

test('client prospect keeps sales continuity without repeated presentation', () => {
  const instructions = actorInstructions({
    role: 'prospect',
    commercialRole: 'client_prospect'
  }, { scopes: [] });

  assert.match(instructions, /prospecto cliente previamente contactado/i);
  assert.match(instructions, /no repitas la presentación inicial/i);
  assert.match(instructions, /no preguntes de forma directa si es cliente o proveedor/i);
});

test('unknown prospect does not invent customer or supplier relationship', () => {
  const instructions = actorInstructions({
    role: 'prospect',
    commercialRole: 'unknown_prospect'
  }, { scopes: [] });

  assert.match(instructions, /no existe evidencia suficiente/i);
  assert.match(instructions, /No inventes esa relación/i);
  assert.match(instructions, /forma natural y no binaria/i);
});
