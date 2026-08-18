'use strict';

const messageService = require('./messageService');
const conversationClient = require('./connectConversationClient');
const { isOwnerPhone, notifyOwner } = require('./ownerNotificationService');

let installed = false;

function clean(value) { return String(value || '').trim(); }
function normalize(value) {
  return clean(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function isProviderOrInternal(args = {}, result = {}) {
  const decision = args.metadata?.connectDecision || {};
  if (decision.relationshipType === 'provider_candidate') return true;
  const role = normalize(result.actorRole || result.context?.actor?.role || '');
  return ['owner', 'provider', 'seller'].includes(role) || /^\s*\[PROVEEDOR REGISTRADO:/i.test(clean(args.message));
}

function handoffReason(message, result, history = []) {
  const input = normalize(message);
  const output = normalize(result?.reply || result?.outputText || '');
  const explicitHuman = /(?:quiero|necesito|puedo|dejame|déjame|pasame|pásame|comunicame|comunícame|transferime|transfiéreme|hablar|habla).*(?:persona|humano|asesor|encargado|supervisor|alguien del equipo)/.test(input)
    || /(?:persona|humano|asesor).*(?:por favor|ahora|ya)/.test(input);
  if (explicitHuman) return 'customer_requested_human';

  const strongFrustration = /\b(no me entiendes|no me estas entendiendo|ya te dije|te lo repito|otra vez lo mismo|esto no sirve|me estas cansando|me estás cansando|deja de repetir|no quiero seguir hablando contigo)\b/.test(input);
  if (strongFrustration) return 'customer_frustration';

  const recentUser = (Array.isArray(history) ? history : [])
    .filter(item => item?.role === 'user')
    .slice(-3)
    .map(item => normalize(item?.content));
  const repeated = recentUser.filter(value => value && input && (value.includes(input) || input.includes(value))).length >= 2;
  if (repeated && /\b(no|pero|ya|respuesta|entiende|explica)\b/.test(input)) return 'conversation_stuck';

  const unsafeUncertainty = /\b(no pude consultar|no puedo confirmar|no tengo informacion suficiente|no tengo información suficiente|no puedo autorizar|no puedo resolver|no seria correcto|no sería correcto|para no darte informacion incorrecta|para no darte información incorrecta)\b/.test(output);
  if (unsafeUncertainty) return 'assistant_cannot_resolve_safely';

  return '';
}

function transferReply() {
  return 'Para darte una respuesta correcta, voy a pasar esta conversación con una persona de nuestro equipo. Ya le estoy compartiendo el contexto para que pueda continuar con vos.';
}

function buildOwnerHandoffNotice(args, reason) {
  const decision = args.metadata?.connectDecision || {};
  const history = Array.isArray(decision.history) ? decision.history.slice(-6) : [];
  const summary = history
    .map(item => `${item?.role === 'assistant' ? 'ELAN' : 'Cliente'}: ${clean(item?.content)}`)
    .filter(Boolean)
    .join('\n')
    .slice(-2400);
  const phone = clean(args.phone || '').replace(/\D/g, '');
  return [
    '⚠️ Intervención humana requerida',
    phone ? `WhatsApp: +${phone}` : '',
    `Motivo: ${reason}`,
    '',
    summary ? `Contexto reciente:\n${summary}` : '',
    `Último mensaje: “${clean(args.message).slice(0, 1000)}”`,
    '',
    'ELAN quedó en silencio para este contacto hasta que la conversación vuelva a asignarse a IA.'
  ].filter(Boolean).join('\n');
}

async function assignConversationHuman(args, reason) {
  const chatId = clean(args.metadata?.chatId || args.externalUserId || args.phone);
  if (!chatId) return null;
  return conversationClient.publishConversationEvent({
    platform: args.platform || 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: args.externalUserId || chatId,
    phone: args.phone || null,
    chatId,
    direction: 'inbound',
    text: '',
    messageType: 'text',
    actorType: 'system',
    actorName: 'ELAN IA',
    assignment: 'human',
    occurredAt: new Date().toISOString(),
    metadata: { source: 'automatic-human-handoff', handoff: true, reason }
  });
}

function handoffResult(previousResult, reason) {
  return {
    ...(previousResult && typeof previousResult === 'object' ? previousResult : {}),
    reply: transferReply(),
    outputText: transferReply(),
    provider: 'elankav',
    model: 'elankav-human-handoff',
    status: 'human_handoff',
    suppressDelivery: false,
    handoff: { active: true, reason }
  };
}

function installHumanHandoffPolicyPatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });

  messageService.processMessage = async function processMessageWithHumanHandoff(args = {}) {
    if (isOwnerPhone(args.phone || args.externalUserId || args.metadata?.senderRaw || '')) return previousProcessMessage(args);

    const decision = args.metadata?.connectDecision || {};
    if (decision.action === 'NO_REPLY' || decision.action === 'PAUSED' || decision.ownerOnly === true) return previousProcessMessage(args);

    const preReason = handoffReason(args.message, null, decision.history || []);
    if (preReason && !isProviderOrInternal(args, {})) {
      await assignConversationHuman(args, preReason);
      await notifyOwner(buildOwnerHandoffNotice(args, preReason));
      return handoffResult(null, preReason);
    }

    const result = await previousProcessMessage(args);
    if (result?.suppressDelivery === true || isProviderOrInternal(args, result)) return result;

    const postReason = handoffReason(args.message, result, decision.history || []);
    if (!postReason) return result;

    await assignConversationHuman(args, postReason);
    await notifyOwner(buildOwnerHandoffNotice(args, postReason));
    return handoffResult(result, postReason);
  };

  installed = true;
  console.log('[HUMAN_HANDOFF_POLICY_PATCH_INSTALLED]', { conservative: true, ownerNotification: true, assignment: 'human' });
  return true;
}

module.exports = {
  assignConversationHuman,
  buildOwnerHandoffNotice,
  handoffReason,
  handoffResult,
  installHumanHandoffPolicyPatch,
  isProviderOrInternal,
  transferReply
};
