'use strict';

const { buildContext } = require('./context/contextBuilder');
const businessCommands = require('./ownerBusinessCommandService');
const {
  COMMAND_TYPE: CONNECT_RUNTIME_AUDIT,
  detectConnectRuntimeAudit,
  executeConnectRuntimeAudit
} = require('./ownerConnectRuntimeAuditService');
const {
  COMMAND_TYPE: PRICE_CATALOG_ADMIN,
  detectOwnerPriceCatalogCommand,
  executeOwnerPriceCatalogCommand
} = require('./ownerPriceCatalogAdminService');
const {
  COMMAND_TYPE: SELLER_READ,
  detectOwnerSellerReadCommand,
  executeOwnerSellerReadCommand
} = require('./ownerSellerReadService');
const {
  COMMAND_TYPE: PROSPECTING_AUTOPILOT,
  detectOwnerProspectingCommand,
  executeOwnerProspectingCommand
} = require('./ownerProspectingCommandService');
const {
  COMMAND_TYPE: PROSPECTING_OUTREACH_AUTOPILOT,
  detectOwnerProspectingOutreachCommand,
  executeOwnerProspectingOutreachCommand
} = require('./ownerProspectingOutreachCommandService');
const {
  COMMAND_TYPE: PROSPECTING_NATURAL_AUDIT,
  detectOwnerProspectingNaturalAudit,
  executeOwnerProspectingNaturalAudit
} = require('./ownerProspectingNaturalAuditService');
const {
  COMMAND_TYPE: OWNER_TEMPLATE_APPROVAL,
  detectOwnerTemplateApproval,
  executeOwnerTemplateApproval
} = require('./ownerTemplateApprovalService');
const {
  COMMAND_TYPE: SELLER_ACCESS_DELIVERY,
  detectOwnerSellerAccessDeliveryCommand,
  executeOwnerSellerAccessDeliveryCommand,
  processSellerOnboardingReply
} = require('./sellerOnboardingService');
const { addItemByHumanReference } = require('./ownerQuotationHomonymResolver');
const { parseAddQuotationItemRequest } = require('./ownerQuotationHumanReferenceParser');
const { resolveCommercialActorSafely } = require('./connectActorIdentityService');
const {
  detectSellerBusinessCommand,
  executeSellerBusinessCommand
} = require('./sellerBusinessCommandService');

const QUOTATION_ITEM_ADD = 'business_quotation_item_add';
const INSTALL_MARK = Symbol.for('elankav.ownerBusinessProcessMessageGateway.installed');

function detectOwnerBusinessCommand(message) {
  const priceAdmin = detectOwnerPriceCatalogCommand(message);
  if (priceAdmin) return priceAdmin;

  const runtimeAudit = detectConnectRuntimeAudit(message);
  if (runtimeAudit) return runtimeAudit;

  const sellerAccessDelivery = detectOwnerSellerAccessDeliveryCommand(message);
  if (sellerAccessDelivery) return sellerAccessDelivery;

  const sellerRead = detectOwnerSellerReadCommand(message);
  if (sellerRead) return sellerRead;

  const templateApproval = detectOwnerTemplateApproval(message);
  if (templateApproval) return templateApproval;

  const prospectingOutreach = detectOwnerProspectingOutreachCommand(message);
  if (prospectingOutreach) return prospectingOutreach;

  const prospectingAudit = detectOwnerProspectingNaturalAudit(message);
  if (prospectingAudit) return prospectingAudit;

  const prospecting = detectOwnerProspectingCommand(message);
  if (prospecting) return prospecting;

  const quotationItemRequest = parseAddQuotationItemRequest(message);
  if (quotationItemRequest) return { type: QUOTATION_ITEM_ADD, input: quotationItemRequest };
  return businessCommands.detectOwnerBusinessCommand(message);
}

async function executeOwnerBusinessCommand(command) {
  if (command?.type === PRICE_CATALOG_ADMIN) return executeOwnerPriceCatalogCommand(command);
  if (command?.type === CONNECT_RUNTIME_AUDIT) return executeConnectRuntimeAudit(command.query || null);
  if (command?.type === SELLER_ACCESS_DELIVERY) return executeOwnerSellerAccessDeliveryCommand(command);
  if (command?.type === SELLER_READ) return executeOwnerSellerReadCommand(command);
  if (command?.type === OWNER_TEMPLATE_APPROVAL) return executeOwnerTemplateApproval(command);
  if (command?.type === PROSPECTING_OUTREACH_AUTOPILOT) return executeOwnerProspectingOutreachCommand(command);
  if (command?.type === PROSPECTING_NATURAL_AUDIT) return executeOwnerProspectingNaturalAudit(command);
  if (command?.type === PROSPECTING_AUTOPILOT) return executeOwnerProspectingCommand(command);
  if (command?.type === QUOTATION_ITEM_ADD) {
    const result = await addItemByHumanReference(command.input || {});
    return { handled: true, outputText: result?.outputText || 'Cotización actualizada.', result };
  }
  return businessCommands.executeOwnerBusinessCommand(command);
}

function buildOwnerContext(args, buildContextImpl = buildContext) {
  return buildContextImpl({
    message: args?.message,
    source: 'messageService-owner-business-gateway',
    platform: args?.platform,
    channel: args?.channel,
    externalUserId: args?.externalUserId,
    phone: args?.phone,
    metadata: args?.metadata && typeof args.metadata === 'object' ? args.metadata : {}
  });
}

function transactionalFailure({ args, context, command, error }) {
  const errorCode = error?.code || 'OWNER_BUSINESS_COMMAND_FAILED';
  const detail = error?.message || 'No fue posible completar la operación empresarial.';
  console.error('[OWNER_BUSINESS_RESULT]', { handler: command?.type || null, status: 'failed', errorCode, platform: context?.platform || args?.platform || 'elanvisual' });
  return {
    message: String(args?.message || '').trim(),
    reply: ['No pude completar la operación empresarial solicitada.', `Error: ${errorCode}`, detail, 'No ejecuté una respuesta generativa ni creé una cotización nueva como alternativa.'].join('\n'),
    provider: 'elankav', model: 'elankav-owner-business-command', responseId: null, status: 'failed', usage: null,
    suppressDelivery: false, command: command?.type || null, jobId: null, ownerCommercialQuery: true, ownerCrmCommand: false,
    ownerBusinessCommand: true, actorRole: 'owner', actorId: null, accessScopes: null, runtimeVersion: null,
    knowledgeAvailable: null, historyMessages: null,
    context: { version: context?.version || null, platform: context?.platform || null, channel: context?.channel || null, externalUserId: context?.externalUserId || null, ownerMode: Boolean(context?.owner?.isOwner) }
  };
}

function transactionalSuccess({ args, context, command, execution }) {
  const resultStatus = execution?.result?.status;
  const status = resultStatus === 'in_progress' ? 'in_progress' : 'completed';
  console.log('[OWNER_BUSINESS_RESULT]', { handler: command?.type || null, status, platform: context?.platform || args?.platform || 'elanvisual' });
  return {
    message: String(args?.message || '').trim(), reply: String(execution?.outputText || '').trim(), provider: 'elankav',
    model: 'elankav-owner-business-command', responseId: null, status, usage: null, suppressDelivery: false,
    command: command?.type || null, jobId: null, ownerCommercialQuery: true, ownerCrmCommand: false, ownerBusinessCommand: true,
    actorRole: 'owner', actorId: null, accessScopes: null, runtimeVersion: null, knowledgeAvailable: null, historyMessages: null,
    context: { version: context?.version || null, platform: context?.platform || null, channel: context?.channel || null, externalUserId: context?.externalUserId || null, ownerMode: Boolean(context?.owner?.isOwner) }
  };
}

function sellerTransactionalFailure({ args, context, command, actor, error }) {
  const errorCode = error?.code || 'SELLER_BUSINESS_COMMAND_FAILED';
  const detail = error?.message || 'No fue posible completar la operación comercial.';
  console.error('[SELLER_BUSINESS_RESULT]', {
    handler: command?.type || null,
    status: 'failed',
    errorCode,
    sellerId: actor?.sellerId || actor?.actorId || null,
    platform: context?.platform || args?.platform || 'elanvisual'
  });
  return {
    message: String(args?.message || '').trim(),
    reply: ['No pude completar la operación comercial solicitada.', `Error: ${errorCode}`, detail, 'No creé un registro alternativo ni cambié el propietario del dato.'].join('\n'),
    provider: 'elankav', model: 'elankav-seller-business-command', responseId: null, status: 'failed', usage: null,
    suppressDelivery: false, command: command?.type || null, jobId: null, ownerCommercialQuery: false, ownerCrmCommand: false,
    ownerBusinessCommand: false, sellerBusinessCommand: true, actorRole: 'seller',
    actorId: actor?.actorId || actor?.sellerId || null, accessScopes: actor?.scopes || null, runtimeVersion: null,
    knowledgeAvailable: null, historyMessages: null,
    context: { version: context?.version || null, platform: context?.platform || null, channel: context?.channel || null, externalUserId: context?.externalUserId || null, ownerMode: false }
  };
}

function sellerTransactionalSuccess({ args, context, command, actor, execution }) {
  console.log('[SELLER_BUSINESS_RESULT]', {
    handler: command?.type || null,
    status: 'completed',
    sellerId: actor?.sellerId || actor?.actorId || null,
    platform: context?.platform || args?.platform || 'elanvisual'
  });
  return {
    message: String(args?.message || '').trim(),
    reply: String(execution?.outputText || '').trim(),
    provider: 'elankav', model: 'elankav-seller-business-command', responseId: null, status: 'completed', usage: null,
    suppressDelivery: false, command: command?.type || null, jobId: null, ownerCommercialQuery: false, ownerCrmCommand: false,
    ownerBusinessCommand: false, sellerBusinessCommand: true, actorRole: 'seller',
    actorId: actor?.actorId || actor?.sellerId || null, accessScopes: actor?.scopes || null, runtimeVersion: null,
    knowledgeAvailable: null, historyMessages: null,
    context: { version: context?.version || null, platform: context?.platform || null, channel: context?.channel || null, externalUserId: context?.externalUserId || null, ownerMode: false }
  };
}

function sellerOnboardingResult({ args, context, onboarding }) {
  return {
    message: String(args?.message || '').trim(),
    reply: onboarding.suppressDelivery ? null : String(onboarding.outputText || '').trim(),
    provider: 'elankav',
    model: 'elankav-seller-onboarding',
    responseId: null,
    status: onboarding.completed ? 'completed' : 'in_progress',
    usage: null,
    suppressDelivery: onboarding.suppressDelivery === true,
    command: null,
    jobId: null,
    ownerCommercialQuery: false,
    ownerCrmCommand: false,
    ownerBusinessCommand: false,
    actorRole: 'seller',
    actorId: null,
    accessScopes: null,
    runtimeVersion: null,
    knowledgeAvailable: null,
    historyMessages: null,
    context: {
      version: context?.version || null,
      platform: context?.platform || null,
      channel: context?.channel || null,
      externalUserId: context?.externalUserId || null,
      ownerMode: false
    }
  };
}

function createOwnerBusinessProcessMessage({
  originalProcessMessage,
  buildContextImpl = buildContext,
  detectCommandImpl = detectOwnerBusinessCommand,
  executeCommandImpl = executeOwnerBusinessCommand,
  onboardingImpl = processSellerOnboardingReply,
  resolveActorImpl = resolveCommercialActorSafely,
  detectSellerCommandImpl = detectSellerBusinessCommand,
  executeSellerCommandImpl = executeSellerBusinessCommand
} = {}) {
  if (typeof originalProcessMessage !== 'function') throw new TypeError('originalProcessMessage es obligatorio');

  return async function processMessageWithOwnerBusinessGateway(args = {}) {
    const context = buildOwnerContext(args, buildContextImpl);

    if (!context?.owner?.isOwner) {
      try {
        const onboarding = await onboardingImpl({ message: args.message, phone: context?.phone || args.phone || null });
        if (onboarding?.handled) {
          console.log('[SELLER_ONBOARDING_ROUTE]', { status: onboarding.completed ? 'completed' : 'in_progress' });
          return sellerOnboardingResult({ args, context, onboarding });
        }
      } catch (error) {
        console.error('[SELLER_ONBOARDING_FAILED]', { code: error?.code || null, message: error?.message || 'unknown' });
      }

      const actor = await resolveActorImpl({
        phone: context?.phone || args.phone || null,
        platform: context?.platform || args.platform || 'ELANVISUAL'
      });

      if (String(actor?.role || '').toLowerCase() === 'seller' && actor?.platformAllowed !== false) {
        const sellerCommand = detectSellerCommandImpl(args.message);
        if (sellerCommand) {
          console.log('[SELLER_ROUTE_SELECTED]', {
            handler: sellerCommand.type,
            sellerId: actor?.sellerId || actor?.actorId || null,
            platform: context?.platform || args.platform || 'elanvisual'
          });
          try {
            const execution = await executeSellerCommandImpl(sellerCommand, actor);
            if (!execution?.handled) {
              const error = new Error(`Handler vendedor ${sellerCommand.type} fue detectado pero no ejecutado.`);
              error.code = 'SELLER_BUSINESS_HANDLER_NOT_EXECUTED';
              return sellerTransactionalFailure({ args, context, command: sellerCommand, actor, error });
            }
            return sellerTransactionalSuccess({ args, context, command: sellerCommand, actor, execution });
          } catch (error) {
            return sellerTransactionalFailure({ args, context, command: sellerCommand, actor, error });
          }
        }
      }

      return originalProcessMessage(args);
    }

    const command = detectCommandImpl(args.message);
    if (!command) return originalProcessMessage(args);

    console.log('[OWNER_ROUTE_SELECTED]', { handler: command.type, platform: context.platform || args.platform || 'elanvisual', ownerMode: true });
    console.log('[OWNER_BUSINESS_EXECUTE]', { handler: command.type, platform: context.platform || args.platform || 'elanvisual' });
    try {
      const execution = await executeCommandImpl(command);
      if (!execution?.handled) {
        const error = new Error(`Handler empresarial ${command.type} fue detectado pero no ejecutado.`);
        error.code = 'OWNER_BUSINESS_HANDLER_NOT_EXECUTED';
        return transactionalFailure({ args, context, command, error });
      }
      return transactionalSuccess({ args, context, command, execution });
    } catch (error) {
      return transactionalFailure({ args, context, command, error });
    }
  };
}

function installOwnerBusinessProcessMessageGateway(messageService = require('./messageService')) {
  if (!messageService || typeof messageService.processMessage !== 'function') throw new TypeError('messageService.processMessage no está disponible');
  if (messageService[INSTALL_MARK]) return messageService.processMessage;
  const originalProcessMessage = messageService.processMessage;
  const wrappedProcessMessage = createOwnerBusinessProcessMessage({ originalProcessMessage });
  Object.defineProperty(messageService, INSTALL_MARK, { value: true, enumerable: false, configurable: false, writable: false });
  messageService.processMessage = wrappedProcessMessage;
  console.log('[OWNER_BUSINESS_GATEWAY_INSTALLED]', {
    boundary: 'processMessage',
    quotationItemAdd: true,
    connectRuntimeAudit: true,
    priceCatalogAdmin: true,
    sellerRead: true,
    sellerAccessDelivery: true,
    prospectingAutopilot: true,
    prospectingOutreachAutopilot: true,
    prospectingNaturalAudit: true,
    ownerTemplateApproval: true,
    sellerOnboarding: true,
    sellerBusinessTransactions: true
  });
  return wrappedProcessMessage;
}

module.exports = {
  CONNECT_RUNTIME_AUDIT,
  PRICE_CATALOG_ADMIN,
  PROSPECTING_AUTOPILOT,
  PROSPECTING_OUTREACH_AUTOPILOT,
  PROSPECTING_NATURAL_AUDIT,
  OWNER_TEMPLATE_APPROVAL,
  QUOTATION_ITEM_ADD,
  SELLER_ACCESS_DELIVERY,
  SELLER_READ,
  createOwnerBusinessProcessMessage,
  detectOwnerBusinessCommand,
  executeOwnerBusinessCommand,
  installOwnerBusinessProcessMessageGateway
};
