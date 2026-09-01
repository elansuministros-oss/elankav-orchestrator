'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('conversation history merge keeps context while removing duplicate turns', () => {
  const { mergeConversationHistories } = require('../services/messageService');

  const result = mergeConversationHistories(
    [
      { role: 'user', content: 'Busco PVC', createdAt: '2026-08-31T20:00:00Z' },
      { role: 'assistant', content: '¿Qué medida?', createdAt: '2026-08-31T20:00:01Z' }
    ],
    [
      { role: 'user', content: 'Busco PVC', createdAt: '2026-08-31T20:00:00Z' },
      { role: 'user', content: 'De 10 mm', createdAt: '2026-08-31T20:00:02Z' }
    ]
  );

  assert.deepEqual(result, [
    { role: 'user', content: 'Busco PVC' },
    { role: 'assistant', content: '¿Qué medida?' },
    { role: 'user', content: 'De 10 mm' }
  ]);
});

test('OpenAI context includes persistent working memory without exposing it as a separate user message', () => {
  const { buildContextInstructions } = require('../services/openaiService');
  const instructions = buildContextInstructions({
    platform: 'ELANVISUAL',
    workingMemory: {
      activeCustomerReference: 'POLARIZADO',
      lastIntent: 'quotation_list_by_customer',
      lastQuotationNumbers: ['COT-A', 'COT-B']
    }
  });

  assert.match(instructions, /MEMORIA DE TRABAJO PERSISTENTE DEL USUARIO/);
  assert.match(instructions, /POLARIZADO/);
  assert.match(instructions, /COT-A/);
  assert.match(instructions, /COT-B/);
});

test('unified runtime returns working state for any actor role using the same memory contract', async () => {
  const clientPath = require.resolve('../services/connectConversationClient');
  const runtimePath = require.resolve('../services/elanUnifiedRuntimeService');
  const savedClient = require.cache[clientPath];
  const savedRuntime = require.cache[runtimePath];
  const calls = [];

  require.cache[clientPath] = {
    id: clientPath,
    filename: clientPath,
    loaded: true,
    exports: {
      readUnifiedMemory: async input => {
        calls.push(input);
        return {
          conversationId: 'conversation-test',
          history: [{ role: 'user', content: 'mensaje previo' }],
          workingState: {
            activeSubject: input.actorRole + '-subject'
          }
        };
      },
      publishUnifiedMemoryEvent: async () => ({}),
      publishUnifiedMemoryEventSafely: async () => ({}),
      writeUnifiedMemoryState: async () => ({}),
      writeUnifiedMemoryStateSafely: async () => ({})
    }
  };

  delete require.cache[runtimePath];
  const runtime = require('../services/elanUnifiedRuntimeService');

  try {
    const roles = ['owner', 'seller', 'provider', 'customer', 'prospect'];
    for (const role of roles) {
      const memory = await runtime.loadConversationMemory({
        actor: {
          role,
          actorId: role + '-1',
          authority: role === 'owner' ? 'owner_identity' : null
        },
        platform: 'ELANVISUAL'
      });

      assert.equal(memory.history[0].content, 'mensaje previo');
      assert.equal(memory.workingState.activeSubject, role + '-subject');
    }

    assert.deepEqual(
      calls.map(call => call.actorRole),
      ['owner', 'seller', 'provider', 'customer', 'prospect']
    );
  } finally {
    delete require.cache[runtimePath];
    if (savedRuntime) require.cache[runtimePath] = savedRuntime;
    if (savedClient) require.cache[clientPath] = savedClient;
    else delete require.cache[clientPath];
  }
});
