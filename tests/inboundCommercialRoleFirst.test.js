'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyInboundCommercialRelationship } = require('../services/inboundCommercialRoleService');
const { detectTarget } = require('../services/ownerOpsSupervisorCommandPatch');

test('supplier-like fair message is provider candidate, not sales prospect', () => {
  const result = classifyInboundCommercialRelationship({
    message: 'Hola, Erick me dio su tarjeta en la feria. Somos proveedores de vinil y queremos enviar catálogo y lista de precios.'
  });
  assert.equal(result.kind, 'provider_candidate');
});

test('buyer-like fair message is sales prospect', () => {
  const result = classifyInboundCommercialRelationship({
    message: 'Hola, Erick me dio su tarjeta en la feria. Necesito cotizar rótulos para mi empresa.'
  });
  assert.equal(result.kind, 'buyer_prospect');
});

test('ambiguous fair greeting stays unclassified until clarification', () => {
  const result = classifyInboundCommercialRelationship({
    message: 'Hola, Erick me dio su tarjeta en la feria.'
  });
  assert.equal(result.kind, 'ambiguous');
});

test('known provider identity overrides buyer-looking wording', () => {
  const result = classifyInboundCommercialRelationship({
    message: 'Necesito precio para unas muestras',
    actor: { role: 'provider', resolutionStatus: 'resolved' }
  });
  assert.equal(result.kind, 'provider');
  assert.equal(result.source, 'known_identity');
});

test('explicit ORCHESTRATOR target wins over negative CONNECT prohibition', () => {
  const text = [
    'ELAN, despliega ORCHESTRATOR producción.',
    'Repositorio: elankav-orchestrator',
    'No despliegues CONNECT.',
    '83e8bbcc590fb02bd81ee03a91dac45a91db949b'
  ].join('\n');
  assert.equal(detectTarget(text), 'orchestrator');
});
