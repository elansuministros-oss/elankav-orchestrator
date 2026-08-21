'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeLiveIntent,
  isLiveModeRequest
} = require('../services/connectLiveAccessService');

test('short ELAN activation aliases route to Live/Copilot', () => {
  for (const input of [
    'ELAN actívate',
    'Actívate ELAN',
    'ELAN activa',
    'activa ELAN'
  ]) {
    assert.equal(isLiveModeRequest(input), true, input);
  }
});

test('existing Copilot/Live commands remain supported', () => {
  for (const input of [
    'ELAN activa modo copiloto',
    'activa copiloto',
    'abre live',
    'ELAN Live',
    'modo piloto'
  ]) {
    assert.equal(isLiveModeRequest(input), true, input);
  }
});

test('short alias normalization accepts accents and punctuation', () => {
  assert.equal(normalizeLiveIntent('  ¡ELAN, ACTÍVATE!  '), 'elan activate');
  assert.equal(isLiveModeRequest('¡ELAN, ACTÍVATE!'), true);
});

test('unrelated activation text does not open Copilot', () => {
  for (const input of [
    'activa la cotización',
    'activar descuento',
    'cliente activo',
    'ELAN revisa la cotización'
  ]) {
    assert.equal(isLiveModeRequest(input), false, input);
  }
});
