'use strict';

const { buildContext } = require('./contextBuilder');
const {
  loadPersistentCommercialState,
  resolveCommercialConversationKey
} = require('../commercialContextService');

async function routeContext(input, next) {
  if (typeof next !== 'function') {
    throw new TypeError('ContextRouter requiere una función next');
  }

  const baseContext = buildContext(input);
  const commercialConversationKey = resolveCommercialConversationKey({
    platform: 'ELANVISUAL',
    channel: baseContext.channel,
    externalUserId: baseContext.externalUserId || input.externalUserId,
    phone: baseContext.owner?.phone || input.phone,
    metadata: input.metadata
  });
  const commercialState = await loadPersistentCommercialState(commercialConversationKey);
  const context = Object.freeze({
    ...baseContext,
    commercial: Object.freeze({
      stateKey: commercialConversationKey,
      state: commercialState
    }),
    memory: Object.freeze({
      ...(baseContext.memory && typeof baseContext.memory === 'object'
        ? baseContext.memory
        : {}),
      commercial: commercialState
    })
  });

  // ORCH-031A es deliberadamente transparente.
  // Los resolvers posteriores recibirán este contexto sin cambiar el contrato actual.
  return next(context);
}

module.exports = {
  routeContext
};
