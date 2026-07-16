import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ElanAiQuoteCommandModule,
  QUOTE_AI_COMMANDS,
  extractCustomerQuery,
  resolveQuoteCommandIntent
} from '../modules/quoteCore/elanAiQuoteCommands.js';

function createService(overrides = {}) {
  return {
    getProjectsByCustomer: async () => [],
    getProductionProjects: async () => [],
    getQuotationsWithoutFollowUp: async () => [],
    getDepositsWithoutWorkOrder: async () => [],
    getProjectsBlockedByPurchases: async () => [],
    ...overrides
  };
}

test('resuelve intención de trabajos en producción', () => {
  assert.equal(
    resolveQuoteCommandIntent('¿Qué trabajos tenemos de Valentina en producción?'),
    QUOTE_AI_COMMANDS.PRODUCTION_BY_CUSTOMER
  );
  assert.equal(extractCustomerQuery('¿Qué trabajos tenemos de Valentina en producción?'), 'Valentina');
});

test('ejecutivo consulta únicamente su propio alcance', async () => {
  let received;
  const module = new ElanAiQuoteCommandModule({
    projectQueryService: createService({
      getProductionProjects: async (params) => {
        received = params;
        return [{ projectNumber: 'PROJ-001', title: 'Rótulo', status: 'production' }];
      }
    })
  });

  const result = await module.execute({
    message: 'Qué trabajos tenemos de Valentina en producción',
    actor: { role: 'ventas', executiveId: 'EXEC-VAL-01' }
  });

  assert.equal(result.handled, true);
  assert.equal(result.scope, 'own');
  assert.equal(received.executiveId, 'EXEC-VAL-01');
  assert.equal(received.customerQuery, 'Valentina');
  assert.match(result.response, /PROJ-001/);
});

test('administrador consulta cotizaciones globales sin seguimiento', async () => {
  const module = new ElanAiQuoteCommandModule({
    projectQueryService: createService({
      getQuotationsWithoutFollowUp: async () => [
        { quotationNumber: 'COT-001', customerName: 'Cliente Uno', status: 'sent' }
      ]
    })
  });

  const result = await module.execute({
    message: 'Qué cotizaciones están sin seguimiento',
    actor: { role: 'admin' }
  });

  assert.equal(result.scope, 'global');
  assert.equal(result.result.count, 1);
  assert.match(result.response, /COT-001/);
});

test('ejecutivo no puede consultar bloqueos internos de compras', async () => {
  const module = new ElanAiQuoteCommandModule({ projectQueryService: createService() });

  await assert.rejects(
    () => module.execute({
      command: QUOTE_AI_COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES,
      actor: { role: 'ventas', executiveId: 'EXEC-01' }
    }),
    /Solo administración/
  );
});

test('rechaza roles no autorizados', async () => {
  const module = new ElanAiQuoteCommandModule({ projectQueryService: createService() });

  await assert.rejects(
    () => module.execute({
      message: 'Qué cotizaciones están sin seguimiento',
      actor: { role: 'cliente' }
    }),
    /Rol no autorizado/
  );
});
