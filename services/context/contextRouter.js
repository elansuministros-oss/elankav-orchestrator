'use strict';

const { buildContext } = require('./contextBuilder');
const {
  loadPersistentCommercialState,
  resolveCommercialConversationKey
} = require('../commercialContextService');
const {
  loadConnectActorIdentitySafely
} = require('../connectActorIdentityService');

function clean(value) {
  return String(value || '').trim();
}

async function routeContext(input, next) {
  if (typeof next !== 'function') {
    throw new TypeError('ContextRouter requiere una función next');
  }

  const baseContext = buildContext(input);
  const actorIdentity = baseContext.channel === 'whatsapp'
    ? await loadConnectActorIdentitySafely({
        identity: input.externalUserId,
        externalUserId: input.externalUserId,
        phone: input.phone,
        chatId: input.metadata?.chatId,
        platform: baseContext.platform
      })
    : {
        available: true,
        authority: 'CONNECT_ACTOR_IDENTITY',
        identity: null,
        notRequired: true
      };

  const verified = actorIdentity.available ? actorIdentity.identity : null;
  const verifiedPhone = clean(verified?.canonicalPhone || verified?.phone);
  const verifiedOwner = verified?.role === 'owner';

  const identityContext = Object.freeze({
    ...baseContext,
    externalUserId: verifiedPhone || baseContext.externalUserId,
    owner: Object.freeze({
      isOwner: verifiedOwner || Boolean(baseContext.owner?.isOwner),
      phone: verifiedPhone || baseContext.owner?.phone || null
    }),
    actorIdentity: Object.freeze({
      available: actorIdentity.available === true,
      authority: actorIdentity.authority,
      error: actorIdentity.error || null,
      ...(verified ? {
        role: verified.role,
        commercialRole: verified.commercialRole || null,
        displayName: verified.displayName || null,
        registered: verified.registered === true,
        resolutionStatus: verified.resolutionStatus || null,
        canonicalPhone: verifiedPhone || null,
        relationshipAuthority: verified.relationshipAuthority || null,
        prospectId: verified.prospectId || null,
        customerId: verified.customerId || null,
        providerId: verified.providerId || null,
        sellerId: verified.sellerId || null,
        familyId: verified.familyId || null,
        outreachContext: verified.outreachContext || null
      } : {})
    })
  });

  const commercialConversationKey = resolveCommercialConversationKey({
    platform: 'ELANVISUAL',
    channel: identityContext.channel,
    externalUserId: identityContext.externalUserId || input.externalUserId,
    phone: identityContext.owner?.phone || input.phone,
    metadata: input.metadata
  });
  const commercialState = await loadPersistentCommercialState(commercialConversationKey);
  const context = Object.freeze({
    ...identityContext,
    commercial: Object.freeze({
      stateKey: commercialConversationKey,
      state: commercialState
    }),
    memory: Object.freeze({
      ...(identityContext.memory && typeof identityContext.memory === 'object'
        ? identityContext.memory
        : {}),
      commercial: commercialState
    })
  });

  return next(context);
}

module.exports = {
  routeContext
};
