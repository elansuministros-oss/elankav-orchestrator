'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generateText } = require('../services/openaiService');

function quotaError() {
  const error = new Error('You exceeded your current quota');
  error.code = 'insufficient_quota';
  error.status = 429;
  return error;
}

test('PROTECTED Owner without credit never falls into customer commercial fallback', async () => {
  const result = await generateText({
    input: 'Modo operador',
    context: { ownerMode: true, customerMode: false },
    history: [],
    instructions: '',
    responseCreator: async () => { throw quotaError(); }
  });

  assert.notEqual(result.model, 'elan-deterministic-commercial-fallback-v1');
  assert.equal(result.model, 'elan-deterministic-owner-fallback-v1');
  assert.match(result.outputText, /sin saldo/i);
});
