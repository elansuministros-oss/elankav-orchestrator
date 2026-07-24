'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  governanceFor,
  isOperationalComponent,
  loadEcosystemContext
} = require('../services/ecosystemContextService');
const {
  COMMERCIAL_CORE
} = require('../services/crmContextService');

test('elankav-core está retirado y no es un componente operativo', () => {
  assert.equal(governanceFor('elankav-core').lifecycle, 'RETIRED');
  assert.equal(
    governanceFor('elansuministros-oss/elankav-core').lifecycle,
    'RETIRED'
  );
  assert.equal(isOperationalComponent('elankav-core'), false);
});

test('ELANKAV CONNECT es el Commercial Core oficial', () => {
  assert.deepEqual(COMMERCIAL_CORE, {
    id: 'elankav-connect',
    name: 'ELANKAV CONNECT',
    role: 'COMMERCIAL_CORE',
    lifecycle: 'ACTIVE',
    official: true
  });
});

test('el contexto operativo excluye Core retirado y conserva CONNECT', async () => {
  const context = await loadEcosystemContext({
    getDashboardDataImpl: async () => ({
      available: true,
      checked_at: '2026-07-24T18:00:00.000Z',
      summary: {
        status: 'OK',
        healthy: true,
        alerts: 0
      },
      data: {
        ecosystem: {
          services: [
            {
              id: 'elankav-core',
              name: 'ELANKAV CORE',
              status: 'online',
              http_status: 200,
              online: true
            },
            {
              id: 'elankav-connect',
              name: 'ELANKAV CONNECT',
              status: 'online',
              http_status: 200,
              online: true
            }
          ]
        },
        github: {
          authenticated: true,
          repositories: [
            {
              full_name: 'elansuministros-oss/elankav-core',
              healthy: true
            },
            {
              full_name: 'elansuministros-oss/elankav-connect',
              healthy: true
            }
          ]
        },
        docker: { containers: [] }
      }
    })
  });

  assert.equal(
    context.services.some(service => service.id === 'elankav-core'),
    false
  );
  assert.equal(
    context.repositories.some(repository =>
      repository.full_name === 'elansuministros-oss/elankav-core'
    ),
    false
  );

  const connect = context.services.find(service => service.id === 'elankav-connect');
  assert.equal(connect.name, 'ELANKAV CONNECT');
  assert.equal(connect.lifecycle, 'ACTIVE');
  assert.equal(connect.role, 'COMMERCIAL_CORE');
  assert.equal(context.architecture.commercialCore.official, true);
  assert.deepEqual(context.retiredComponents, [
    {
      id: 'elankav-core',
      name: 'ELANKAV Core',
      lifecycle: 'RETIRED',
      includedInOperationalContext: false
    }
  ]);
});
