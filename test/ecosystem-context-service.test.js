const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadEcosystemContext
} = require('../services/ecosystemContextService');
const {
  buildContextInstructions
} = require('../services/openaiService');

test('loadEcosystemContext compacta dashboard sin exponer secretos', async () => {
  const context = await loadEcosystemContext({
    getDashboardDataImpl: async () => ({
      available: true,
      summary: {
        status: 'OK',
        healthy: true,
        alerts: 0,
        resources: { memory_usage_percent: 50 }
      },
      data: {
        ecosystem: {
          services: [
            { id: 'waha', name: 'WAHA', status: 'online', http_status: 401, online: true, url: 'secret-url' }
          ]
        },
        github: {
          authenticated: true,
          repositories: [
            {
              full_name: 'elansuministros-oss/elan-ai',
              branch: 'main',
              default_branch: 'main',
              branch_matches_default: true,
              healthy: true,
              last_commit: {
                short_sha: 'abc1234',
                message: 'commit',
                date: '2026-07-12T00:00:00Z',
                url: 'secret-url'
              },
              rate_limit: { remaining: 4000 }
            }
          ]
        },
        docker: {
          containers: [
            { name: 'waha', running: true, status: 'Up 3 days', stats: { memory: '1GB' } }
          ]
        }
      },
      checked_at: '2026-07-12T05:00:00Z'
    })
  });

  assert.equal(context.available, true);
  assert.equal(context.githubAuthenticated, true);
  assert.equal(context.services[0].name, 'WAHA');
  assert.equal(context.repositories[0].last_commit.short_sha, 'abc1234');
  assert.equal(context.containers[0].running, true);
  assert.equal('url' in context.services[0], false);
  assert.equal('rate_limit' in context.repositories[0], false);
  assert.equal('stats' in context.containers[0], false);
});

test('loadEcosystemContext degrada sin romper la conversación', async () => {
  const context = await loadEcosystemContext({
    getDashboardDataImpl: async () => {
      throw new Error('dashboard fuera de línea');
    }
  });

  assert.equal(context.available, false);
  assert.equal(context.status, 'ERROR');
  assert.equal(context.error, 'dashboard fuera de línea');
});

test('buildContextInstructions informa acceso verificado al ecosistema', () => {
  const instructions = buildContextInstructions({
    ownerMode: true,
    ownerName: 'Erick Cano',
    ecosystem: {
      available: true,
      status: 'OK',
      healthy: true,
      alerts: 0,
      githubAuthenticated: true,
      services: [{ name: 'WAHA', online: true }],
      repositories: [{ full_name: 'elansuministros-oss/elan-ai', healthy: true }],
      containers: [{ name: 'waha', running: true }]
    }
  });

  assert.match(instructions, /Orchestrator está conectado/);
  assert.match(instructions, /GitHub autenticado=true/);
  assert.match(instructions, /WAHA/);
  assert.match(instructions, /elan-ai/);
});
