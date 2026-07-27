'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  loadEcosystemContext
} = require('../services/ecosystemContextService');
const {
  buildContextInstructions
} = require('../services/openaiService');

const DASHBOARD = {
  available: true,
  summary: {
    status: 'READY',
    healthy: true,
    alerts: 0
  },
  data: {
    ecosystem: { services: [] },
    github: { repositories: [], authenticated: true },
    docker: { containers: [] }
  },
  checked_at: '2026-07-27T18:00:00.000Z'
};

const APPROVED_KNOWLEDGE = {
  available: true,
  source: 'ELANKAV_CONNECT',
  policy: 'approved-commercial-catalogs-only',
  platformId: 'elanvisual',
  payload: {
    platform: 'ELANVISUAL',
    sourcePolicy: 'approved-commercial-catalogs-only',
    identity: [
      {
        title: 'Tecnologías de impresión',
        content: 'TrueVIS LG/MG, Epson SureColor'
      }
    ],
    rules: []
  }
};

test('Owner recibe catálogos comerciales aprobados dentro del contexto verificado', async () => {
  const ecosystem = await loadEcosystemContext({
    getDashboardDataImpl: async () => DASHBOARD,
    loadKnowledgeImpl: async () => APPROVED_KNOWLEDGE,
    platform: 'ELANVISUAL',
    query: '¿Qué tecnologías de impresión utiliza ELANVISUAL según sus catálogos?'
  });

  const instructions = buildContextInstructions({
    ownerMode: true,
    ownerName: 'Erick Cano',
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    ecosystem
  });

  assert.equal(ecosystem.approvedCommercialKnowledge.available, true);
  assert.match(instructions, /Catálogos comerciales aprobados de ELANVISUAL/);
  assert.match(instructions, /approved-commercial-catalogs-only/);
  assert.match(instructions, /TrueVIS LG\/MG/);
  assert.match(instructions, /Epson SureColor/);
});

test('Owner conserva operación cuando CONNECT no expone conocimiento', async () => {
  const ecosystem = await loadEcosystemContext({
    getDashboardDataImpl: async () => DASHBOARD,
    loadKnowledgeImpl: async () => null,
    platform: 'ELANVISUAL'
  });

  assert.equal(ecosystem.available, true);
  assert.equal(ecosystem.approvedCommercialKnowledge, null);
  assert.equal(
    ecosystem.services.some(service => service.id === 'approved-commercial-catalogs-elanvisual'),
    false
  );
});
