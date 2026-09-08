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

async function withoutCredit(input, context = {}) {
  return generateText({
    input,
    context,
    history: [],
    instructions: '',
    responseCreator: async () => { throw quotaError(); }
  });
}

test('no credit never exposes sin saldo to customer', async () => {
  const result = await withoutCredit('Hola');
  assert.equal(result.model, 'elan-deterministic-commercial-fallback-v1');
  assert.equal(result.status, 'completed');
  assert.doesNotMatch(result.outputText, /sin saldo/i);
  assert.match(result.outputText, /cotizar|consultar/i);
});
test('no credit asks only the missing commercial datum', async () => {
  const result = await withoutCredit('Quiero cotizar un rótulo para exterior');
  assert.match(result.outputText, /medida aproximada/i);
  assert.doesNotMatch(result.outputText, /formulario|sin saldo/i);
});

test('no credit uses official price knowledge when a match exists', async () => {
  const result = await withoutCredit('¿Cuál es el precio del vinil?', {
    officialKnowledge: {
      available: true,
      payload: {
        products: [
          { name: 'Vinil adhesivo', unitPrice: 12.5, currency: 'USD', unit: 'm2' }
        ]
      }
    }
  });
  assert.match(result.outputText, /Vinil adhesivo/i);
  assert.match(result.outputText, /USD 12\.50/i);
  assert.doesNotMatch(result.outputText, /sin saldo/i);
});

test('no credit with measure does not ask measure again', async () => {
  const result = await withoutCredit('Necesito cotizar 120 x 80 cm');
  assert.match(result.outputText, /producto|acabado/i);
  assert.doesNotMatch(result.outputText, /qué medida aproximada/i);
});
