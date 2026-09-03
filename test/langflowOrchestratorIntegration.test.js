'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const planner = fs.readFileSync(path.join(root, 'services/langflowPlannerService.js'), 'utf8');
const runtimePatch = fs.readFileSync(path.join(root, 'services/elanUnifiedRuntimeMessagePatch.js'), 'utf8');
const registry = fs.readFileSync(path.join(root, 'services/elanUnifiedToolRegistry.js'), 'utf8');
const connectClient = fs.readFileSync(path.join(root, 'services/ownerBusinessConnectClient.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');

test('Orchestrator owns Langflow runtime access and does not depend on an SSH tunnel', () => {
  assert.match(planner, /http:\/\/127\.0\.0\.1:7860/);
  assert.match(planner, /\/api\/v1\/run\//);
  assert.match(planner, /'x-api-key'/);
  assert.match(planner, /\/api\/v1\/login/);
  assert.match(planner, /\/api\/v1\/api_key\//);
  assert.match(planner, /mode: 0o600/);
  assert.match(server, /langflowPlannerService\.bootstrap\(\)/);
  assert.doesNotMatch(planner, /ssh\s+-L|127\.0\.0\.1:7860:127\.0\.0\.1:7860/);
});

test('Langflow planner is semantic-only and cannot select write or delivery tools', () => {
  const setMatch = runtimePatch.match(/const LANGFLOW_READ_TOOLS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(setMatch, 'LANGFLOW_READ_TOOLS must exist');
  const readSet = setMatch[1];
  assert.match(readSet, /buscar_material_catalogo/);
  assert.match(readSet, /buscar_cliente/);
  assert.match(readSet, /buscar_proveedor/);
  assert.doesNotMatch(readSet, /crear_/);
  assert.doesNotMatch(readSet, /editar_/);
  assert.doesNotMatch(readSet, /desactivar_/);
  assert.doesNotMatch(readSet, /eliminar_/);
  assert.doesNotMatch(readSet, /enviar_/);
  assert.match(runtimePatch, /hasExplicitMutationIntent/);
  assert.match(runtimePatch, /materialSupplierReadIntent/);
  assert.match(runtimePatch, /material_supplier_catalog_guard/);
});

test('material search is a single read-only CONNECT capability', () => {
  assert.match(registry, /name:'buscar_material_catalogo'/);
  assert.match(registry, /case'buscar_material_catalogo'/);
  assert.match(registry, /quién vende|quien vende|quién.*material|quien.*material/i);
  assert.match(connectClient, /\/api\/v1\/catalog\/items/);
  assert.match(connectClient, /providerMap/);
  assert.match(connectClient, /suppliers/);
  assert.match(connectClient, /startsWith\('\/api\/v1\/catalog\/items'\)&&method==='GET'/);
  assert.doesNotMatch(connectClient, /startsWith\('\/api\/v1\/catalog\/'\)&&method!=='GET'/);
});


test('clear material plus supplier question is routed before Langflow and provider regex fallbacks', () => {
  const phrase = 'ELAN, buscá materiales de acrílico en ELANVISUAL y decime qué proveedor los tiene.';
  const runtime = require('../services/elanUnifiedRuntimeMessagePatch');
  assert.equal(runtime.materialSupplierReadIntent(phrase), true);
  assert.equal(runtime.materialQueryFromMessage(phrase), 'acrílico');

  const fastPathIndex = runtimePatch.indexOf("const fastResult=await executeGenericOwnerCommand");
  const plannerIndex = runtimePatch.indexOf("const plannedResult=await executeLangflowReadPlanner");
  const deterministicIndex = runtimePatch.indexOf("const unifiedCommand=detectOwnerUnifiedCommand");

  assert.ok(fastPathIndex >= 0, 'material supplier fast path must exist');
  assert.ok(plannerIndex > fastPathIndex, 'fast path must run before Langflow planner');
  assert.ok(deterministicIndex > fastPathIndex, 'fast path must run before provider/entity regex fallback');
  assert.match(runtimePatch, /tool:'buscar_material_catalogo'/);
  assert.match(runtimePatch, /lastIntent:'material_supplier_catalog_lookup'/);
});

test('planner never enables Langflow OpenAPI dangerous requests', () => {
  assert.doesNotMatch(planner, /allow_dangerous_requests/i);
  assert.doesNotMatch(planner, /OpenAPI Agent/i);
  assert.match(fs.readFileSync(path.join(root, 'services/elanUnifiedOwnerCommandService.js'), 'utf8'), /row\?\.suppliers/);
  assert.match(planner, /nunca ejecutes acciones/i);
});
