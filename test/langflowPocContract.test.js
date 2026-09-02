'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const compose = fs.readFileSync(path.join(root, 'deploy/langflow/docker-compose.yml'), 'utf8');
const spec = fs.readFileSync(path.join(root, 'deploy/langflow/connect-readonly.openapi.yaml'), 'utf8');

test('Langflow POC stays pinned, authenticated and localhost-only', () => {
  assert.match(compose, /image:\s+langflowai\/langflow:1\.12\.0/);
  assert.match(compose, /127\.0\.0\.1:7860:7860/);
  assert.match(compose, /LANGFLOW_AUTO_LOGIN:\s+"false"/);
  assert.match(compose, /LANGFLOW_ENABLE_SIGNUP:\s+"false"/);
  assert.match(compose, /LANGFLOW_API_KEY_SOURCE:\s+env/);
  assert.match(compose, /LANGFLOW_ALLOW_CUSTOM_COMPONENTS:\s+"false"/);
  assert.match(compose, /LANGFLOW_ALLOW_COMPONENTS_PATHS_OVERRIDE:\s+"false"/);
  assert.match(compose, /LANGFLOW_BLOCK_CODE_INTERPRETER_COMPONENTS:\s+"true"/);
  assert.match(compose, /LANGFLOW_RESTRICT_LOCAL_FILE_ACCESS:\s+"true"/);
  assert.match(compose, /LANGFLOW_MCP_SERVER_DOCKER_HARDENING:\s+"true"/);
  assert.match(compose, /LANGFLOW_TWEAKS_POLICY:\s+declared/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /\/health_check/);
});

test('Langflow POC secrets are external to Git checkout', () => {
  assert.match(compose, /\/var\/lib\/elankav-langflow\/langflow\.env/);
  assert.match(compose, /\/var\/lib\/elankav-langflow\/data:\/app\/langflow/);
  assert.doesNotMatch(compose, /CHANGE_ME/);
});

test('CONNECT OpenAPI POC excludes messaging, campaigns, deploy and destructive routes', () => {
  assert.match(spec, /buscarClientes/);
  assert.match(spec, /buscarProveedores/);
  assert.match(spec, /resolverPrecioAutorizado/);
  assert.match(spec, /listarCotizaciones/);
  assert.doesNotMatch(spec, /send-whatsapp/i);
  assert.doesNotMatch(spec, /campaign/i);
  assert.doesNotMatch(spec, /repository\.deploy/i);
  assert.doesNotMatch(spec, /\/payments/);
  assert.doesNotMatch(spec, /\bdelete:/i);
  assert.doesNotMatch(spec, /\bpatch:/i);
  assert.doesNotMatch(spec, /\bput:/i);
});
