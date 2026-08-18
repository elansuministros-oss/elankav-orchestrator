'use strict';

const { normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const {
  createDelegation,
  findOpenDelegationByPhone
} = require('./businessDelegationService');

let providerCommandInstalled = false;
let candidateMessageInstalled = false;

async function createIfMissing(input) {
  const existing = await findOpenDelegationByPhone(input.phone);
  if (existing && existing.kind === input.kind && String(existing.objective || '') === String(input.objective || '')) return existing.job;
  return createDelegation(input);
}

function installProviderCommandDelegationPatch() {
  if (providerCommandInstalled) return false;
  const service = require('./ownerBusinessCommandService');
  const previousExecute = service.executeOwnerBusinessCommand;
  if (typeof previousExecute !== 'function') throw Object.assign(new Error('OWNER_BUSINESS_COMMAND_EXECUTOR_REQUIRED'), { code: 'OWNER_BUSINESS_COMMAND_EXECUTOR_REQUIRED' });

  service.executeOwnerBusinessCommand = async function executeOwnerBusinessCommandWithDelegation(command) {
    const result = await previousExecute(command);
    if (command?.type !== service.BUSINESS_COMMANDS.PROVIDER_QUOTE_REQUEST || !result?.handled) return result;

    const payload = result.result || {};
    const provider = payload.provider || {};
    const sent = payload.sent || {};
    const phone = normalizePhone(provider.whatsapp || provider.phone);
    if (!phone || !sent?.chatId) return result;

    const requestKind = payload.requestKind || command.requestKind || 'quote';
    const providerName = String(provider.tradeName || provider.legalName || command.providerName || 'Proveedor').trim();
    const item = String(payload.item || command.item || '').trim();
    const objective = requestKind === 'status'
      ? `obtener seguimiento/estado de ${item}`
      : `obtener cotización y disponibilidad de ${item}`;

    const delegation = await createIfMissing({
      kind: requestKind === 'status' ? 'provider_followup' : 'supplier_quote',
      counterpartyName: providerName,
      phone,
      objective,
      requestedItems: item,
      relationshipType: 'provider',
      metadata: {
        providerId: provider.id || provider.providerId || null,
        requestKind,
        outboundMessageId: sent.messageId || null,
        outboundChatId: sent.chatId || null
      }
    });

    return {
      ...result,
      result: { ...payload, delegationId: delegation?.id || null },
      outputText: `${result.outputText}\n\n📌 Encargo abierto: ELAN seguirá esta solicitud y te avisará cuando responda, falte una decisión o venza el tiempo de espera.`
    };
  };

  providerCommandInstalled = true;
  console.log('[PROVIDER_COMMAND_DELEGATION_PATCH_INSTALLED]', { quote: true, status: true });
  return true;
}

function installProviderCandidateDelegationMessagePatch() {
  if (candidateMessageInstalled) return false;
  const messageService = require('./messageService');
  const candidateOutreach = require('./ownerProviderCandidateOutreachMessagePatch');
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });

  messageService.processMessage = async function processMessageWithCandidateDelegation(args = {}) {
    const result = await previousProcessMessage(args);
    if (result?.command?.type !== 'provider_candidate_outreach') return result;

    const parsed = candidateOutreach.parseProviderCandidateOutreach(args.message) || result.command;
    const phone = normalizePhone(parsed.phone || result.command.phone);
    if (!phone) return result;
    const objective = parsed.objective || 'conocer servicios, forma de trabajo y condiciones comerciales para evaluar una posible alianza';
    const delegation = await createIfMissing({
      kind: 'provider_discovery',
      counterpartyName: parsed.name || result.command.name || 'Posible proveedor',
      phone,
      objective,
      requestedItems: parsed.serviceHint || null,
      relationshipType: 'provider_candidate',
      metadata: {
        serviceHint: parsed.serviceHint || null,
        outboundMessageId: result.command.messageId || null
      }
    });

    return {
      ...result,
      command: { ...result.command, delegationId: delegation?.id || null },
      reply: `${result.reply}\n\n📌 Encargo abierto: voy a seguir esta conversación y te avisaré cuando obtenga información útil, surja un bloqueo o no respondan a tiempo.`
    };
  };

  candidateMessageInstalled = true;
  console.log('[PROVIDER_CANDIDATE_DELEGATION_PATCH_INSTALLED]', { persistent: true });
  return true;
}

module.exports = {
  createIfMissing,
  installProviderCandidateDelegationMessagePatch,
  installProviderCommandDelegationPatch
};
