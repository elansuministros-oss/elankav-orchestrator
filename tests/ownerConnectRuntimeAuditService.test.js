'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMAND_TYPE,
  detectConnectRuntimeAudit,
  executeConnectRuntimeAudit,
  formatRuntimeAudit
} = require('../services/ownerConnectRuntimeAuditService');
const {
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessProcessMessageGateway');

test('detects explicit Owner request to audit CONNECT price datasource', () => {
  const command = detectConnectRuntimeAudit('ELAN audita la fuente de precios de CONNECT');
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);

  const routed = detectOwnerBusinessCommand('ELAN verifica qué Supabase usa CONNECT para precios');
  assert.ok(routed);
  assert.equal(routed.type, COMMAND_TYPE);
});

test('does not hijack unrelated Owner audit commands', () => {
  assert.equal(detectConnectRuntimeAudit('ELAN audita producción'), null);
  assert.equal(detectConnectRuntimeAudit('ELAN revisa los logs del Orchestrator'), null);
});

test('formats safe runtime audit without credentials', () => {
  const output = formatRuntimeAudit({
    data: {
      readOnly: true,
      secretsExposed: false,
      runtime: { deploymentTarget: 'SELF_HOSTED', commit: null },
      supabase: { projectRef: 'veltwfkokfqlmadtniea', urlConfigured: true },
      data: {
        commercialProducts: { ok: true, count: 6, error: null },
        aiPlatformKnowledge: { ok: true, count: 12, error: null },
        authorizedResolverSchema: { compatibleWithAuthorizedResolver: true, error: null },
        resolverProbe: {
          ok: true,
          status: 'MULTIPLE',
          matchCount: 4,
          matches: [
            { id: 'boton-transparente', name: 'Botón Transparente 60 cm' },
            { id: 'boton-uv', name: 'Botón Impresión UV Premium 60 cm' }
          ]
        }
      }
    }
  });

  assert.match(output, /Supabase project ref: veltwfkokfqlmadtniea/);
  assert.match(output, /Prueba resolver: MULTIPLE/);
  assert.match(output, /Coincidencias: 4/);
  assert.match(output, /Secretos expuestos: NO/);
  assert.doesNotMatch(output, /service_role|VQS_API_TOKEN|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('executes only the authenticated CONNECT runtime-audit endpoint', async () => {
  const calls = [];
  const execution = await executeConnectRuntimeAudit(async (path) => {
    calls.push(path);
    return {
      data: {
        runtime: { deploymentTarget: 'VERCEL', commit: '1234567890abcdef1234567890abcdef12345678' },
        supabase: { projectRef: 'projectref', urlConfigured: true },
        data: {
          commercialProducts: { ok: true, count: 6 },
          aiPlatformKnowledge: { ok: true, count: 10 },
          authorizedResolverSchema: { compatibleWithAuthorizedResolver: false, error: 'SUPABASE_HTTP_400' },
          resolverProbe: { ok: false, error: 'SUPABASE_HTTP_400', status: null, matchCount: 0, matches: [] }
        }
      }
    };
  });

  assert.deepEqual(calls, ['/api/v1/business/vqs/runtime-audit']);
  assert.equal(execution.handled, true);
  assert.match(execution.outputText, /Runtime: VERCEL/);
  assert.match(execution.outputText, /Esquema compatible con resolver autorizado: NO/);
});
