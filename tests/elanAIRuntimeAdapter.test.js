'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  CONTRACT_VERSION,
  invokeElanAIRuntime
} = require('../adapters/elanAIRuntimeAdapter');
const {
  observeWithElanAI
} = require('../services/elanAIRuntimeShadowService');

function createRequest() {
  return {
    version: CONTRACT_VERSION,
    requestId: 'orch-request-001',
    mode: 'shadow',
    channel: 'whatsapp',
    message: 'Necesito una cotización',
    identity: {
      externalUserId: '50588888888',
      phone: '50588888888',
      ownerMode: false
    },
    context: {
      platform: 'elanvisual',
      permissions: ['customer:observe'],
      conversationHistory: []
    }
  };
}

test('adapter invoca contrato interno autenticado', async () => {
  let received = null;

  const result = await invokeElanAIRuntime({
    request: createRequest(),
    baseUrl: 'http://127.0.0.1:4200/',
    authToken: 'secret',
    fetchImpl: async (url, options) => {
      received = { url, options };
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            version: CONTRACT_VERSION,
            requestId: 'orch-request-001',
            runtimeRequestId: 'runtime-request-001',
            decision: {
              intent: 'quote',
              operator: 'sales',
              allowed: true,
              cancelled: false
            },
            output: {
              text: 'Resultado observado',
              deliverable: false
            }
          };
        }
      };
    }
  });

  assert.equal(
    received.url,
    'http://127.0.0.1:4200/v1/runtime/messages'
  );
  assert.equal(received.options.headers['X-ELAN-AI-Token'], 'secret');
  assert.equal(JSON.parse(received.options.body).mode, 'shadow');
  assert.equal(result.runtimeRequestId, 'runtime-request-001');
});

test('shadow queda apagado por defecto y no invoca runtime', async () => {
  let invoked = false;
  const result = await observeWithElanAI({
    message: 'Hola',
    context: { channel: 'whatsapp' },
    mode: 'off',
    invokeRuntime: async () => {
      invoked = true;
    }
  });

  assert.equal(invoked, false);
  assert.equal(result.status, 'SKIPPED');
  assert.equal(result.enabled, false);
});

test('shadow conserva Owner Mode sin autorizar entrega', async () => {
  let receivedRequest = null;
  const result = await observeWithElanAI({
    message: 'Revisá mis cotizaciones',
    context: {
      version: 'ORCH-038',
      requestId: 'owner-request-001',
      channel: 'whatsapp',
      platform: 'elankav',
      externalUserId: '50588388940',
      owner: {
        isOwner: true,
        phone: '50588388940'
      }
    },
    mode: 'shadow',
    invokeRuntime: async ({ request }) => {
      receivedRequest = request;
      return {
        version: CONTRACT_VERSION,
        requestId: request.requestId,
        runtimeRequestId: 'runtime-owner-001',
        decision: {
          intent: 'quote',
          operator: 'sales',
          allowed: true,
          cancelled: false
        }
      };
    }
  });

  assert.equal(receivedRequest.identity.ownerMode, true);
  assert.deepEqual(
    receivedRequest.context.permissions,
    ['owner:observe']
  );
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.deliverable, false);
  assert.equal(result.fallback, 'current-message-service');
});

test('fallo del runtime no interrumpe el fallback actual', async () => {
  const originalWarn = console.warn;
  console.warn = () => {};

  try {
    const result = await observeWithElanAI({
      message: 'Hola',
      context: {
        channel: 'whatsapp',
        externalUserId: '50588888888'
      },
      mode: 'shadow',
      invokeRuntime: async () => {
        const error = new Error('offline');
        error.code = 'ELAN_AI_RUNTIME_TIMEOUT';
        throw error;
      }
    });

    assert.equal(result.status, 'UNAVAILABLE');
    assert.equal(result.errorCode, 'ELAN_AI_RUNTIME_TIMEOUT');
    assert.equal(result.fallback, 'current-message-service');
    assert.equal(result.deliverable, false);
  } finally {
    console.warn = originalWarn;
  }
});

test('controlled ejecuta solo para Owner Mode y nunca entrega a WhatsApp', async () => {
  let receivedRequest = null;
  const result = await observeWithElanAI({
    message: 'Revisá mis cotizaciones',
    context: {
      channel: 'whatsapp',
      externalUserId: '50588388940',
      owner: {
        isOwner: true,
        phone: '50588388940'
      }
    },
    mode: 'controlled',
    invokeRuntime: async ({ request }) => {
      receivedRequest = request;
      return {
        version: CONTRACT_VERSION,
        requestId: request.requestId,
        decision: {
          intent: 'quote',
          operator: 'sales',
          allowed: true,
          cancelled: false
        },
        audit: {
          toolsExecuted: true,
          toolCalls: [{
            toolName: 'connect',
            operation: 'quotes.list',
            status: 'SUCCESS'
          }]
        }
      };
    }
  });

  assert.equal(receivedRequest.mode, 'active');
  assert.ok(
    receivedRequest.context.permissions.includes('connect:quotes:read')
  );
  assert.equal(
    receivedRequest.context.permissions.some(
      permission => permission.endsWith(':write')
    ),
    false
  );
  assert.equal(result.status, 'CONTROLLED');
  assert.equal(result.audit.toolsExecuted, true);
  assert.equal(result.deliverable, false);
});

test('controlled no ejecuta herramientas para clientes', async () => {
  let receivedRequest = null;
  const result = await observeWithElanAI({
    message: 'Mostrame los clientes',
    context: {
      channel: 'whatsapp',
      externalUserId: '50588888888',
      owner: {
        isOwner: false,
        phone: '50588888888'
      }
    },
    mode: 'controlled',
    invokeRuntime: async ({ request }) => {
      receivedRequest = request;
      return {
        version: CONTRACT_VERSION,
        requestId: request.requestId,
        decision: {
          intent: 'crm',
          operator: 'crm',
          allowed: true,
          cancelled: false
        },
        audit: { toolsExecuted: false, toolCalls: [] }
      };
    }
  });

  assert.equal(receivedRequest.mode, 'shadow');
  assert.deepEqual(
    receivedRequest.context.permissions,
    ['customer:observe']
  );
  assert.equal(result.status, 'OBSERVED');
  assert.equal(result.audit.toolsExecuted, false);
});
