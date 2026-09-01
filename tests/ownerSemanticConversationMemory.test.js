'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

function loadSemanticService(outputFactory) {
  const adapterPath = require.resolve('../adapters/openaiAdapter');
  const servicePath = require.resolve('../services/ownerSemanticIntentService');
  const savedAdapter = require.cache[adapterPath];
  const savedService = require.cache[servicePath];
  const calls = [];

  require.cache[adapterPath] = {
    id: adapterPath,
    filename: adapterPath,
    loaded: true,
    exports: {
      createResponse: async input => {
        calls.push(input);
        return {
          outputText: JSON.stringify(outputFactory(input)),
          model: 'test-model',
          id: 'test-response',
          status: 'completed'
        };
      }
    }
  };

  delete require.cache[servicePath];
  const service = require('../services/ownerSemanticIntentService');

  function cleanup() {
    delete require.cache[servicePath];
    if (savedService) require.cache[servicePath] = savedService;
    if (savedAdapter) require.cache[adapterPath] = savedAdapter;
    else delete require.cache[adapterPath];
  }

  return { service, calls, cleanup };
}

test('semantic resolver keeps the owner intent: quotations of POLARIZADO are not projects or customer list', async () => {
  const { service, calls, cleanup } = loadSemanticService(() => ({
    intent: 'quotation_list_by_customer',
    confidence: 0.99,
    customerReference: 'POLARIZADO',
    providerReference: null,
    query: null,
    expectedCount: null,
    usesContext: false
  }));

  try {
    const semantic = await service.resolveOwnerSemanticIntent({
      message: 'BUSCA LAS COTIZACIONES DEL CLIENTE POLARIZADO QUE HAY',
      history: []
    });

    const command = service.semanticIntentToBusinessCommand(semantic);
    assert.equal(command.type, 'business_quotation_customer_list');
    assert.equal(command.customerReference, 'POLARIZADO');
    assert.equal(calls.length, 1);
    assert.match(String(calls[0].input), /COTIZACIONES DEL CLIENTE POLARIZADO/i);
  } finally {
    cleanup();
  }
});

test('short follow-up POLARIZADO recovers quotation intent from recent conversation history', async () => {
  const { service, calls, cleanup } = loadSemanticService(input => {
    assert.match(String(input.input), /Busca las cotizaciones de POLARIZADO/i);
    assert.match(String(input.input), /MENSAJE ACTUAL DEL OWNER:\nPOLARIZADO/i);
    return {
      intent: 'quotation_list_by_customer',
      confidence: 0.96,
      customerReference: 'POLARIZADO',
      providerReference: null,
      query: null,
      expectedCount: null,
      usesContext: true
    };
  });

  try {
    const history = [
      { role: 'user', content: 'Elan busca las cotizaciones de polarizado que tengamos' },
      { role: 'assistant', content: 'No encontré proyectos de polarizado que tengamos.' },
      { role: 'user', content: 'BUSCA LAS COTIZACIONES DEL CLIENTE POLARIZADO QUE HAY' },
      { role: 'assistant', content: 'Clientes oficiales registrados: 3' }
    ];

    assert.equal(service.shouldResolveOwnerSemanticIntent('POLARIZADO', history), true);

    const semantic = await service.resolveOwnerSemanticIntent({
      message: 'POLARIZADO',
      history
    });

    assert.equal(semantic.intent, 'quotation_list_by_customer');
    assert.equal(semantic.customerReference, 'POLARIZADO');
    assert.equal(semantic.usesContext, true);
    assert.equal(calls.length, 1);
  } finally {
    cleanup();
  }
});

test('contextual mandaselas maps to sending the already divided quotation group', async () => {
  const { service, cleanup } = loadSemanticService(() => ({
    intent: 'quotation_send_split',
    confidence: 0.98,
    customerReference: 'POLARIZADO',
    providerReference: null,
    query: null,
    expectedCount: 2,
    usesContext: true
  }));

  try {
    const semantic = await service.resolveOwnerSemanticIntent({
      message: 'mandáselas',
      history: [
        { role: 'user', content: 'busca las cotizaciones de POLARIZADO' },
        { role: 'assistant', content: 'Encontré dos alternativas para POLARIZADO.' }
      ]
    });

    const command = service.semanticIntentToBusinessCommand(semantic);
    assert.equal(command.type, 'business_quotation_split_send');
    assert.equal(command.customerReference, 'POLARIZADO');
    assert.equal(command.expectedCount, 2);
  } finally {
    cleanup();
  }
});

test('semantic quotation layer does not intercept unrelated provider or customer administration', () => {
  const { service, cleanup } = loadSemanticService(() => ({
    intent: 'unknown',
    confidence: 0.1,
    customerReference: null,
    providerReference: null,
    query: null,
    expectedCount: null,
    usesContext: false
  }));

  try {
    assert.equal(service.shouldResolveOwnerSemanticIntent('Busca proveedor Vargas Centro', []), false);
    assert.equal(service.shouldResolveOwnerSemanticIntent('Lista de clientes registrados', []), false);
    assert.equal(service.shouldResolveOwnerSemanticIntent('Agrega un vendedor nuevo', []), false);
  } finally {
    cleanup();
  }
});
