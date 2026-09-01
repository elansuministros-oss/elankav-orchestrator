'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMANDS,
  processQuoteRuntimeCommand,
  resolveIntent
} = require('../services/quoteCore/quoteCommandRuntimeService');
const {
  OWNER_COMMANDS,
  detectOwnerCommand,
  executeOwnerCommand
} = require('../services/ownerCommandService');

function memoryReader() {
  return {
    async select(table) {
      if (table === 'elankav_projects') {
        return [{
          id: 'p-1',
          project_number: 'PROJ-001',
          title: 'Rótulo luminoso',
          status: 'production',
          current_stage: 'fabricación',
          customer_snapshot: { name: 'Valentina Ruiz', companyName: 'Valentina Studio' }
        }];
      }
      return [];
    }
  };
}

test('QUOTE-CORE-05 reconoce consulta operacional de producción', () => {
  assert.equal(
    resolveIntent('Qué trabajos tenemos de Valentina en producción'),
    COMMANDS.PRODUCTION_BY_CUSTOMER
  );
});

test('QUOTE-CORE-05 responde usando el alcance owner global', async () => {
  const result = await processQuoteRuntimeCommand({
    message: 'Qué trabajos tenemos de Valentina en producción',
    actor: { role: 'owner' },
    reader: memoryReader()
  });

  assert.equal(result.handled, true);
  assert.equal(result.scope, 'global');
  assert.match(result.outputText, /PROJ-001/);
  assert.match(result.outputText, /Valentina/);
});

test('QUOTE-CORE-05 queda deshabilitado por defecto y no captura mensajes', async () => {
  const result = await processQuoteRuntimeCommand({
    message: 'Qué cotizaciones están sin seguimiento',
    actor: { role: 'owner' },
    env: {}
  });

  assert.equal(result.handled, false);
  assert.equal(result.reason, 'QUOTE_CORE_RUNTIME_DISABLED');
});

test('Owner Commands existentes conservan prioridad', () => {
  const previous = process.env.QUOTE_CORE_RUNTIME_ENABLED;
  process.env.QUOTE_CORE_RUNTIME_ENABLED = 'true';
  try {
    assert.equal(detectOwnerCommand('context sync'), OWNER_COMMANDS.CONTEXT_SYNC);
    assert.equal(detectOwnerCommand('cancelar'), OWNER_COMMANDS.CANCEL_FLOW);
    assert.equal(
      detectOwnerCommand('Qué cotizaciones están sin seguimiento').type,
      OWNER_COMMANDS.QUOTE_QUERY
    );
  } finally {
    if (previous === undefined) delete process.env.QUOTE_CORE_RUNTIME_ENABLED;
    else process.env.QUOTE_CORE_RUNTIME_ENABLED = previous;
  }
});

test('executeOwnerCommand entrega la consulta Quote Core mediante el router owner', async () => {
  const previous = process.env.QUOTE_CORE_RUNTIME_ENABLED;
  process.env.QUOTE_CORE_RUNTIME_ENABLED = 'true';
  try {
    const originalFetch = global.fetch;
    global.fetch = async url => {
      const value = String(url);
      if (value.includes('/elankav_projects?')) {
        return new Response(JSON.stringify([{
          id: 'p-1', project_number: 'PROJ-001', title: 'Rótulo luminoso',
          status: 'production', current_stage: 'fabricación',
          customer_snapshot: { name: 'Valentina Ruiz' }
        }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('[]', { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const oldUrl = process.env.SUPABASE_URL;
    const oldKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';

    const result = await executeOwnerCommand({
      command: {
        type: OWNER_COMMANDS.QUOTE_QUERY,
        message: 'Qué trabajos tenemos de Valentina en producción'
      },
      platform: 'elanvisual'
    });

    assert.equal(result.command, OWNER_COMMANDS.QUOTE_QUERY);
    assert.equal(result.job, null);
    assert.match(result.outputText, /PROJ-001/);

    global.fetch = originalFetch;
    if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
    if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldKey;
  } finally {
    if (previous === undefined) delete process.env.QUOTE_CORE_RUNTIME_ENABLED;
    else process.env.QUOTE_CORE_RUNTIME_ENABLED = previous;
  }
});
