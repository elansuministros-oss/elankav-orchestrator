'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const interpreter = require('../services/humanLanguageInterpreter');

test('normalizes common human spelling mistakes without changing names or numbers', () => {
  const input = 'ELAN, escrivele a Arq. Karen Vega Flores y actualisá su infornación al +505 8617 5429';
  const output = interpreter.normalizeHumanMessage(input);
  assert.match(output, /escribile a Arq\. Karen Vega Flores/i);
  assert.match(output, /actualiza su informacion/i);
  assert.match(output, /\+505 8617 5429/);
  assert.match(output, /Karen Vega Flores/);
});

test('understands WhatsApp spelling variants', () => {
  assert.equal(
    interpreter.normalizeHumanMessage('cambiale el wasap a Karen'),
    'cambiale el whatsapp a Karen'
  );
});

test('routes the exact Owner phrase for adding a WhatsApp to an existing seller by name', () => {
  const command = interpreter.detectSellerFieldUpdate(
    'ELAN, agregale a Arq. Karen Vega Flores el WhatsApp +505 8617 5429'
  );
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.action, 'edit');
  assert.equal(command?.query, 'Arq. Karen Vega Flores');
  assert.equal(command?.data?.whatsapp, '+50586175429');
  assert.equal(command?.data?.phone, '+50586175429');
  assert.equal(command?.tool, 'previsualizar_editar_vendedor');
});

test('routes a misspelled WhatsApp update into the same safe preview intent', () => {
  const command = interpreter.detectSellerFieldUpdate(
    'elan agragale a karen vega el wasap 86175429'
  );
  assert.equal(command?.sellerPreview, true);
  assert.equal(command?.query, 'karen vega');
  assert.equal(command?.data?.whatsapp, '+50586175429');
});

test('routes email and zone updates by human name without UUIDs', () => {
  const email = interpreter.detectSellerFieldUpdate('cambiale a Karen Vega el correo karen@example.com');
  assert.equal(email?.query, 'Karen Vega');
  assert.equal(email?.data?.email, 'karen@example.com');

  const zone = interpreter.detectSellerFieldUpdate('actualizale a Karen Vega la zona Masaya');
  assert.equal(zone?.query, 'Karen Vega');
  assert.equal(zone?.data?.zone, 'Masaya');
});

test('does not invent a structured seller mutation from unrelated conversation', () => {
  assert.equal(interpreter.detectSellerFieldUpdate('Karen dijo que mañana llega temprano.'), null);
});
