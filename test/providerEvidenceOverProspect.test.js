'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveInboundClassification } = require('../services/inboundCommercialRoleMessagePatch');

const prospect = { resolutionStatus: 'resolved', role: 'prospect' };

test('explicit Ferromax evidence overrides stale prospect label', () => {
  const result = resolveInboundClassification({
    message: 'Para enviar la cotización de láminas lisa',
    phone: '50584937395',
    metadata: { connectDecision: { history: [{ content: 'Le saluda Luis Jarquin\nDe Ferromax Huembes' }] } }
  }, prospect);
  assert.equal(result.kind, 'provider_candidate');
  assert.equal(result.source, 'explicit_provider_evidence');
});

test('commercial PDF overrides stale prospect label', () => {
  const result = resolveInboundClassification({
    message: '[Archivo recibido: Cotizacion de Andamios Erick Cano 07-09-26.pdf]',
    phone: '50585854070',
    metadata: { whatsappName: 'Alquichevez', messageType: 'document', media: { filename: 'Cotizacion de Andamios Erick Cano 07-09-26.pdf' } }
  }, prospect);
  assert.equal(result.kind, 'provider_candidate');
});

test('confirmed customer identity is not overridden', () => {
  const result = resolveInboundClassification({ message: 'Para enviar la cotización', phone: '50580000000' }, { resolutionStatus: 'resolved', role: 'customer' });
  assert.equal(result.kind, 'customer');
});
