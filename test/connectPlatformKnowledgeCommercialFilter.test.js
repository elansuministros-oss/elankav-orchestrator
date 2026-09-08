'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  commercialQueryTokens,
  filterCommercialKnowledgePayload
} = require('../services/connectPlatformKnowledgeService');

const frost = {
  id: 'frost',
  title: 'Vinil frost con impresión UV',
  tags: ['vinil frost', 'frost', 'impresion uv'],
  data: { name: 'Vinil frost con impresión UV', aliases: ['frost impreso', 'vinil fros'], sku: 'vinil-frost-impresion-uv' }
};
const mesh = {
  id: 'mesh',
  title: 'Lona mesh',
  tags: ['lona', 'mesh'],
  data: { name: 'Lona mesh', aliases: ['banner mesh'], sku: 'lona-mesh' }
};
const payload = { identity: [], rules: [], knowledge: [frost, mesh] };

test('ignora palabras comerciales genéricas y conserva términos del producto', () => {
  assert.deepEqual(commercialQueryTokens('¿Cuánto cuesta el vinil frost impreso?'), ['vinil', 'frost']);
});

test('no deja pasar Frost para productos no relacionados', () => {
  for (const query of ['precio letras acrilico', 'precio rotulo neon', 'precio pintura de avion']) {
    assert.deepEqual(filterCommercialKnowledgePayload(payload, query).knowledge, []);
  }
});

test('conserva coincidencias reales por nombre alias SKU o tag', () => {
  assert.deepEqual(filterCommercialKnowledgePayload(payload, 'precio del frost').knowledge.map((x) => x.id), ['frost']);
  assert.deepEqual(filterCommercialKnowledgePayload(payload, 'cuánto vale lona mesh').knowledge.map((x) => x.id), ['mesh']);
});

test('consulta genérica de tecnología no elige un producto arbitrario', () => {
  assert.deepEqual(filterCommercialKnowledgePayload(payload, '¿cuánto cuesta impresión UV?').knowledge, []);
});
