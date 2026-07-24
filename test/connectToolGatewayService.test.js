'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ConnectToolGatewayService
} = require('../services/connectToolGatewayService');

const UUID = '11111111-1111-4111-8111-111111111111';

function fakeClient() {
  const calls = [];
  return {
    calls,
    async request(input) {
      calls.push(input);
      return { connected: true };
    }
  };
}

test('gateway consulta leads mediante contrato oficial', async () => {
  const client = fakeClient();
  const service = new ConnectToolGatewayService({ client });
  const result = await service.execute({
    operation: 'leads.list',
    input: { status: 'new', ignored: 'value' },
    permissions: ['connect:leads:read'],
    mode: 'active'
  });

  assert.equal(result.operation, 'leads.list');
  assert.deepEqual(client.calls[0], {
    method: 'GET',
    path: '/api/v1/leads',
    query: { status: 'new' }
  });
});

test('gateway crea cotización desde oportunidad sin filtrar el id al body', async () => {
  const client = fakeClient();
  const service = new ConnectToolGatewayService({ client });
  await service.execute({
    operation: 'quotes.create-from-opportunity',
    input: { opportunityId: UUID, title: 'Rótulo exterior' },
    permissions: ['connect:quotes:write'],
    mode: 'active'
  });

  assert.deepEqual(client.calls[0], {
    method: 'POST',
    path: `/api/v1/opportunities/${UUID}/quotes`,
    body: { title: 'Rótulo exterior' }
  });
});

test('gateway bloquea shadow, permisos insuficientes y ids inválidos', async () => {
  const service = new ConnectToolGatewayService({ client: fakeClient() });

  await assert.rejects(
    service.execute({
      operation: 'orders.list',
      permissions: ['connect:orders:read'],
      mode: 'shadow'
    }),
    error => error.code === 'CONNECT_TOOL_ACTIVE_MODE_REQUIRED'
  );
  await assert.rejects(
    service.execute({ operation: 'customers.list', mode: 'active' }),
    error => error.code === 'CONNECT_TOOL_PERMISSION_DENIED'
  );
  await assert.rejects(
    service.execute({
      operation: 'leads.get',
      input: { leadId: 'invalid' },
      permissions: ['connect:leads:read'],
      mode: 'active'
    }),
    error => error.code === 'CONNECT_TOOL_LEADID_INVALID'
  );
});
