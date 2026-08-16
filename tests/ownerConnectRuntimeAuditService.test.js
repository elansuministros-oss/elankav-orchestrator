'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  COMMAND_TYPE,
  detectConnectRuntimeAudit,
  executeConnectRuntimeAudit,
  extractProductAuditQuery,
  formatRuntimeAudit
} = require('../services/ownerConnectRuntimeAuditService');
const {
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessProcessMessageGateway');

test('detects explicit Owner request to audit CONNECT price datasource', () => {
  const command = detectConnectRuntimeAudit('ELAN audita la fuente de precios de CONNECT');
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.query, null);

  const routed = detectOwnerBusinessCommand('ELAN verifica qué Supabase usa CONNECT para precios');
  assert.ok(routed);
  assert.equal(routed.type, COMMAND_TYPE);
});

test('extracts a requested product from a detailed Owner audit command', () => {
  const message = 'ELAN audita READ-ONLY los productos de Plataforma IA relacionados con “rótulo botón acrílico”. Mostrame únicamente título y precio.';
  assert.equal(extractProductAuditQuery(message), 'rótulo botón acrílico');

  const command = detectOwnerBusinessCommand(message);
  assert.ok(command);
  assert.equal(command.type, COMMAND_TYPE);
  assert.equal(command.query, 'rótulo botón acrílico');
});

test('does not hijack unrelated Owner audit commands', () => {
  assert.equal(detectConnectRuntimeAudit('ELAN audita producción'), null);
  assert.equal(detectConnectRuntimeAudit('ELAN revisa los logs del Orchestrator'), null);
});

test('formats safe runtime audit with product-level fields and no credentials', () => {
  const output = formatRuntimeAudit({
    data: {
      readOnly: true,
      secretsExposed: false,
      runtime: { deploymentTarget: 'SELF_HOSTED', commit: null },
      supabase: { projectRef: 'veltwfkokfqlmadtniea', urlConfigured: true },
      data: {
        commercialProducts: { ok: true, count: 0, error: null },
        aiPlatformKnowledge: { ok: true, count: 190, error: null },
        authorizedResolverSchema: {
          compatibleWithAuthorizedResolver: true,
          authorityTable: 'elankav_ai_platform_knowledge',
          error: null
        },
        resolverProbe: {
          ok: true,
          query: 'rótulo botón acrílico',
          status: 'NOT_FOUND',
          matchCount: 0,
          matches: []
        },
        productDetailProbe: {
          ok: true,
          query: 'rótulo botón acrílico',
          matchCount: 2,
          products: [
            {
              title: 'Rótulo Botón Transparente 60 cm',
              sku: 'BOTON-TRANSP-60',
              recordStatus: 'ACTIVE',
              publicationStatus: 'PUBLISHED',
              approved: true,
              approvedPrice: false,
              aliases: ['rotulo boton', 'boton acrilico'],
              price: { value: 100, currency: 'USD', formulaType: 'PRECIO_FIJO_CON_MEDIDA_BASE' },
              baseMeasure: { width: 0.6, height: 0.6, areaM2: 0.36 }
            },
            {
              title: 'Rótulo Botón UV 60 cm',
              sku: 'BOTON-UV-60',
              recordStatus: 'ACTIVE',
              publicationStatus: 'DRAFT',
              approved: false,
              approvedPrice: false,
              aliases: ['boton uv'],
              price: { value: 150, currency: 'USD', formulaType: 'PRECIO_FIJO_CON_MEDIDA_BASE' },
              baseMeasure: { width: 0.6, height: 0.6, areaM2: 0.36 }
            }
          ]
        }
      }
    }
  });

  assert.match(output, /Supabase project ref: veltwfkokfqlmadtniea/);
  assert.match(output, /Fuente autorizada: elankav_ai_platform_knowledge/);
  assert.match(output, /Consulta de producto: rótulo botón acrílico/);
  assert.match(output, /Rótulo Botón Transparente 60 cm/);
  assert.match(output, /approvedPrice: NO/);
  assert.match(output, /Precio: USD 100/);
  assert.match(output, /Medida base: 0.6 × 0.6 m/);
  assert.match(output, /Secretos expuestos: NO/);
  assert.doesNotMatch(output, /service_role|VQS_API_TOKEN|SUPABASE_SERVICE_ROLE_KEY/i);
});

test('executes generic runtime audit endpoint for legacy call signature', async () => {
  const calls = [];
  const execution = await executeConnectRuntimeAudit(async (path) => {
    calls.push(path);
    return {
      data: {
        runtime: { deploymentTarget: 'VERCEL', commit: '1234567890abcdef1234567890abcdef12345678' },
        supabase: { projectRef: 'projectref', urlConfigured: true },
        data: {
          commercialProducts: { ok: true, count: 0 },
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

test('passes requested human product query to authenticated CONNECT runtime audit', async () => {
  const calls = [];
  const execution = await executeConnectRuntimeAudit('rótulo botón acrílico', async (path) => {
    calls.push(path);
    return {
      data: {
        runtime: { deploymentTarget: 'SELF_HOSTED', commit: null },
        supabase: { projectRef: 'veltwfkokfqlmadtniea' },
        data: {
          commercialProducts: { ok: true, count: 0 },
          aiPlatformKnowledge: { ok: true, count: 190 },
          authorizedResolverSchema: { compatibleWithAuthorizedResolver: true, authorityTable: 'elankav_ai_platform_knowledge' },
          resolverProbe: { ok: true, query: 'rótulo botón acrílico', status: 'NOT_FOUND', matchCount: 0, matches: [] },
          productDetailProbe: { ok: true, query: 'rótulo botón acrílico', matchCount: 0, products: [] }
        }
      }
    };
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0], /^\/api\/v1\/business\/vqs\/runtime-audit\?query=/);
  assert.equal(new URL(`http://localhost${calls[0]}`).searchParams.get('query'), 'rótulo botón acrílico');
  assert.equal(execution.handled, true);
});
