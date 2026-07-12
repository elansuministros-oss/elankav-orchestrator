'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeWhatsappE164 } = require('../services/phoneService');

test('normaliza numero local de Nicaragua', () => {
  assert.equal(normalizeWhatsappE164('8577-4826'), '+50585774826');
});

test('conserva numero internacional con signo mas', () => {
  assert.equal(normalizeWhatsappE164('+506 8888 7777'), '+50688887777');
});

test('convierte prefijo internacional 00', () => {
  assert.equal(normalizeWhatsappE164('00504 9999 8888'), '+50499998888');
});

test('rechaza numero extranjero sin codigo internacional', () => {
  assert.equal(normalizeWhatsappE164('888877777'), '');
});

test('rechaza formato demasiado corto', () => {
  assert.equal(normalizeWhatsappE164('12345'), '');
});
