'use strict';

const messageService = require('./messageService');
const { isLiveModeRequest, requestLiveSession } = require('./connectLiveAccessService');

const originalProcessMessage = messageService.processMessage;
const DEFAULT_OWNER_PHONE = '50588388940';

function normalizePhone(value) {
  const raw = String(value || '').split('@')[0].replace(/\D/g, '');
  if (!raw) return '';
  return raw.length === 8 ? `505${raw}` : raw;
}

function ownerPhones() {
  const configured = String(
    process.env.ORCHESTRATOR_OWNER_PHONES ||
    process.env.ORCHESTRATOR_OWNER_PHONE ||
    ''
  ).split(',').map(normalizePhone).filter(Boolean);
  return configured.length ? configured : [DEFAULT_OWNER_PHONE];
}

function isOwner(input = {}) {
  const candidates = [
    input.phone,
    input.externalUserId,
    input.metadata?.senderRaw,
    input.metadata?.chatId,
    ...(Array.isArray(input.metadata?.identityCandidates) ? input.metadata.identityCandidates : [])
  ].map(normalizePhone).filter(Boolean);
  return candidates.some(phone => ownerPhones().includes(phone));
}

messageService.processMessage = async function liveCopilotProcessMessagePatch(input = {}) {
  if (!isOwner(input) || !isLiveModeRequest(input.message)) {
    return originalProcessMessage(input);
  }

  const session = await requestLiveSession({
    phone: normalizePhone(input.phone) || ownerPhones()[0],
    externalUserId: input.externalUserId || input.metadata?.senderRaw || input.metadata?.chatId || null,
    platform: input.platform || 'ELANVISUAL'
  });

  return {
    reply: `ELAN Copiloto listo. Abrí tu sesión segura:\n${session.url}`,
    model: 'ELAN_LIVE_ACCESS',
    context: {
      ownerMode: true,
      platform: input.platform || 'ELANVISUAL',
      liveAccess: true
    }
  };
};
