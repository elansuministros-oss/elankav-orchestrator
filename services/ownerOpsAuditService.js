'use strict';

const crypto = require('node:crypto');
const { addJob } = require('./jobs/jobQueue');
const { publishConversationEventSafely } = require('./connectConversationClient');

function createAuditId(now = Date.now()) {
  return `AUDIT-${now}-${crypto.randomUUID().slice(0, 8)}`;
}

function isProviderOutboundCapability(capability) {
  return [
    'business.provider.message.send',
    'business.provider.quote-request.send'
  ].includes(String(capability || '').trim());
}

function providerConversationText(capability, metadata = {}) {
  const provider = String(metadata.provider || '').trim() || 'proveedor';
  const item = String(metadata.item || '').trim() || 'solicitud pendiente';
  if (capability === 'business.provider.quote-request.send') {
    return `Solicitud enviada por Owner a ${provider}: pedir cotización/precio de ${item}. Quedamos a la espera de la respuesta del proveedor.`;
  }
  return `Solicitud enviada por Owner a ${provider}: consultar seguimiento/estado de ${item}. Quedamos a la espera de la respuesta del proveedor.`;
}

async function persistProviderOutboundContinuity({ capability, metadata, createdAt }) {
  if (!isProviderOutboundCapability(capability)) return null;
  const chatId = String(metadata?.chatId || '').trim();
  const phone = String(metadata?.phone || '').trim();
  if (!chatId && !phone) return null;

  const resolvedChatId = chatId || `${phone.replace(/\D/g, '')}@c.us`;
  return publishConversationEventSafely({
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: resolvedChatId,
    phone: phone || null,
    chatId: resolvedChatId,
    direction: 'outbound',
    text: providerConversationText(capability, metadata),
    messageType: 'text',
    externalMessageId: metadata?.messageId || null,
    actorType: 'owner',
    actorName: 'Owner',
    occurredAt: createdAt,
    metadata: {
      source: 'owner-provider-outbound-continuity',
      providerMode: true,
      providerId: metadata?.providerId || null,
      providerName: metadata?.provider || null,
      requestKind: metadata?.requestKind || null,
      pendingProviderRequest: true,
      subject: metadata?.item || null
    }
  });
}

async function recordAudit({
  capability,
  target = null,
  source = 'owner-whatsapp',
  success = true,
  errorCode = null,
  metadata = {}
}) {
  const now = new Date().toISOString();
  const entry = {
    id: createAuditId(),
    type: 'owner_ops_audit',
    platform: 'elankav',
    task: capability || 'unknown',
    branch: null,
    status: success ? 'completed' : 'failed',
    steps: [],
    result: {
      audit: {
        capability: capability || null,
        target,
        source,
        success: Boolean(success),
        errorCode: errorCode || null,
        metadata: metadata && typeof metadata === 'object' ? metadata : {},
        // Deliberately metadata-only. stdout/stderr, secrets and raw message bodies
        // must never be persisted by this audit service.
        outputPersisted: false,
        createdAt: now
      }
    },
    error: success ? null : (errorCode || 'OWNER_OPS_FAILED'),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    finishedAt: now
  };

  const savedJob = await addJob(entry);
  if (success && isProviderOutboundCapability(capability)) {
    await persistProviderOutboundContinuity({ capability, metadata, createdAt: now });
  }
  return savedJob;
}

async function recordAuditSafely(input) {
  try {
    return await recordAudit(input);
  } catch (error) {
    console.error('[OWNER_OPS_AUDIT_WRITE_FAILED]', {
      capability: input?.capability || null,
      target: input?.target || null,
      code: error?.code || error?.message || 'UNKNOWN'
    });
    return null;
  }
}

module.exports = {
  createAuditId,
  isProviderOutboundCapability,
  persistProviderOutboundContinuity,
  providerConversationText,
  recordAudit,
  recordAuditSafely
};