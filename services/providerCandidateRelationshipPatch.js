'use strict';

const conversationClient = require('./connectConversationClient');
const {
  buildProviderCandidateInstructions,
  resolveProviderCandidateRelationship
} = require('./providerCandidateRelationshipService');

let installed = false;
const CANDIDATE_IDENTITY_TTL_MS = 10 * 60 * 1000;
const candidateIdentityCache = new Map();

function clean(value) {
  return String(value || '').trim();
}

function isRegisteredProviderMessage(value) {
  return /^\s*\[PROVEEDOR REGISTRADO:/i.test(clean(value));
}

function actorKeyFromEvent(event = {}) {
  return clean(event.phone || event.externalUserId || event.chatId);
}

function cacheCandidateIdentity(event = {}, candidate, now = Date.now()) {
  if (!candidate) return;
  const keys = [event.externalUserId, event.chatId, event.phone]
    .map(clean)
    .filter(Boolean);
  for (const key of keys) {
    candidateIdentityCache.set(key, {
      candidate,
      expiresAt: now + CANDIDATE_IDENTITY_TTL_MS
    });
  }
}

function cachedCandidateForIdentity(identity, now = Date.now()) {
  const key = clean(identity);
  if (!key) return null;
  const entry = candidateIdentityCache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= now) {
    candidateIdentityCache.delete(key);
    return null;
  }
  return entry.candidate || null;
}

function clearCandidateIdentityCache() {
  candidateIdentityCache.clear();
}

function candidateDecision(candidate, memory, platform) {
  const history = Array.isArray(memory?.history) ? memory.history : [];
  return {
    ok: true,
    action: 'RESPOND',
    reason: 'provider_candidate_continuity',
    relationshipType: 'provider_candidate',
    relationship: {
      type: 'provider_candidate',
      name: candidate.name,
      phone: candidate.phone,
      stage: candidate.stage || 'evaluation',
      serviceHint: candidate.serviceHint || null
    },
    platform: { platformId: String(platform || 'ELANVISUAL').toUpperCase() },
    instructions: buildProviderCandidateInstructions(candidate),
    prospect: null,
    history,
    platformHistory: history,
    conversationId: memory?.conversationId || null,
    welcome: { send: false, text: '' }
  };
}

function installProviderCandidateRelationshipPatch() {
  if (installed) return false;

  const previousDecision = conversationClient.requestConversationDecision;
  const previousPublish = conversationClient.publishConversationEventSafely;
  const readMemory = conversationClient.readUnifiedMemory;
  const publishMemory = conversationClient.publishUnifiedMemoryEventSafely;

  if (typeof previousDecision !== 'function' || typeof previousPublish !== 'function') {
    throw Object.assign(new Error('PROVIDER_CANDIDATE_CONVERSATION_CLIENT_REQUIRED'), {
      code: 'PROVIDER_CANDIDATE_CONVERSATION_CLIENT_REQUIRED'
    });
  }

  conversationClient.requestConversationDecision = async function requestConversationDecisionWithProviderCandidate(
    args = {},
    options = {}
  ) {
    const message = clean(args.message);

    // Registered providers always keep precedence over any older candidate audit.
    if (isRegisteredProviderMessage(message) || args.ownerMode === true) {
      return previousDecision(args, options);
    }

    let candidate = cachedCandidateForIdentity(args.identity);
    if (!candidate) {
      try {
        candidate = await resolveProviderCandidateRelationship({
          phone: args.phone || args.identity
        });
      } catch (error) {
        console.error('[PROVIDER_CANDIDATE_RESOLVE_FAILED]', {
          code: error?.code || null,
          message: error?.message || String(error)
        });
      }
    }

    if (!candidate) return previousDecision(args, options);

    let memory = { history: [], conversationId: null };
    try {
      memory = await readMemory({
        actorKey: candidate.phone,
        actorRole: 'provider_candidate',
        platform: args.platform || 'ELANVISUAL',
        limit: 30
      });
    } catch (error) {
      console.error('[PROVIDER_CANDIDATE_MEMORY_READ_FAILED]', {
        code: error?.code || null,
        message: error?.message || String(error)
      });
    }

    return candidateDecision(candidate, memory, args.platform);
  };

  conversationClient.publishConversationEventSafely = async function publishConversationEventWithProviderCandidate(
    event = {},
    options = {}
  ) {
    // Preserve official provider behavior exactly as before.
    if (conversationClient.isProviderConversationEvent(event)) {
      return previousPublish(event, options);
    }

    const actorKey = actorKeyFromEvent(event);
    if (!actorKey) return previousPublish(event, options);

    let candidate = null;
    try {
      candidate = await resolveProviderCandidateRelationship({ phone: actorKey });
    } catch (error) {
      console.error('[PROVIDER_CANDIDATE_EVENT_RESOLVE_FAILED]', {
        code: error?.code || null,
        message: error?.message || String(error)
      });
    }

    if (!candidate) return previousPublish(event, options);

    // Cache every inbound identity representation (phone, @c.us, @lid) so the
    // decision call that immediately follows can recover the candidate even when
    // WAHA exposes a LID instead of the canonical phone.
    cacheCandidateIdentity(event, candidate);

    const text = clean(event.text);
    if (text && ['inbound', 'outbound'].includes(String(event.direction || '').toLowerCase())) {
      await publishMemory({
        actorKey: candidate.phone,
        actorRole: 'provider_candidate',
        platform: event.platform || 'ELANVISUAL',
        sourceChannel: event.channel || 'whatsapp',
        direction: String(event.direction).toLowerCase(),
        text,
        messageType: event.messageType || 'text',
        externalMessageId: event.externalMessageId || null,
        occurredAt: event.occurredAt || new Date().toISOString()
      }, options).catch(error => {
        console.error('[PROVIDER_CANDIDATE_MEMORY_WRITE_FAILED]', {
          code: error?.code || null,
          message: error?.message || String(error)
        });
      });
    }

    return {
      ok: true,
      skipped: true,
      reason: 'PROVIDER_CANDIDATE_NOT_PROSPECT',
      relationshipType: 'provider_candidate',
      candidateName: candidate.name,
      actorKey: candidate.phone
    };
  };

  installed = true;
  console.log('[PROVIDER_CANDIDATE_RELATIONSHIP_PATCH_INSTALLED]', {
    prospectIsolation: true,
    unifiedMemory: true,
    lidBridge: true,
    registeredProviderPrecedence: true
  });
  return true;
}

module.exports = {
  CANDIDATE_IDENTITY_TTL_MS,
  actorKeyFromEvent,
  cacheCandidateIdentity,
  cachedCandidateForIdentity,
  candidateDecision,
  clearCandidateIdentityCache,
  installProviderCandidateRelationshipPatch,
  isRegisteredProviderMessage
};
