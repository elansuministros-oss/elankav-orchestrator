'use strict';

const { buildContext } = require('./context/contextBuilder');
const { executeThroughConnect, formatAuthorizedPriceResult } = require('./elanUnifiedRuntimeService');
const { installOwnerBusinessProcessMessageGateway } = require('./ownerBusinessProcessMessageGateway');

const INSTALL_MARK = Symbol.for('elankav.elanUnifiedRuntimeMessagePatch.installed');

function detectAuthorizedPriceLookup(message) {
  const text = String(message || '').trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  if (/\b(agrega|agregar|publica|publicar|aprueba|aprobar|actualiza|actualizar|cambia|cambiar|elimina|eliminar)\b/i.test(lower)) return null;
  if (!/(cu[aá]l\s+es\s+el\s+precio|cu[aá]nto\s+cuesta|cu[aá]nto\s+vale|precio\s+(?:autorizado\s+)?de|costo\s+de)/i.test(text)) return null;

  let query = text
    .replace(/^\s*elan\s*[,;:\-]?\s*/i, '')
    .replace(/^.*?(?:cu[aá]l\s+es\s+el\s+precio\s+(?:autorizado\s+)?de|cu[aá]nto\s+cuesta|cu[aá]nto\s+vale|precio\s+(?:autorizado\s+)?de|costo\s+de)\s*/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  if (!query) return null;
  return { tool: 'buscar_precio_autorizado', arguments: { query } };
}

function runtimeResult({ args, context, execution, reply }) {
  return {
    message: String(args?.message || '').trim(),
    reply,
    provider: 'elankav',
    model: 'elan-unified-runtime',
    responseId: null,
    status: 'completed',
    usage: null,
    suppressDelivery: false,
    command: 'buscar_precio_autorizado',
    jobId: null,
    ownerCommercialQuery: true,
    ownerCrmCommand: false,
    ownerBusinessCommand: true,
    actorRole: execution?.actor?.role || 'owner',
    actorId: execution?.actor?.actorId || 'owner',
    accessScopes: execution?.actor?.scopes || ['*'],
    runtimeVersion: execution?.version || '1.0.0',
    knowledgeAvailable: true,
    historyMessages: null,
    context: {
      version: context?.version || null,
      platform: context?.platform || args?.platform || 'ELANVISUAL',
      channel: context?.channel || args?.channel || 'whatsapp',
      externalUserId: context?.externalUserId || args?.externalUserId || null,
      ownerMode: true,
      runtime: 'ELAN_UNIFIED_RUNTIME',
      authority: 'CONNECT'
    }
  };
}

function installElanUnifiedRuntimeMessagePatch(messageService = require('./messageService')) {
  installOwnerBusinessProcessMessageGateway(messageService);
  if (!messageService || typeof messageService.processMessage !== 'function') throw new TypeError('messageService.processMessage no está disponible');
  if (messageService[INSTALL_MARK]) return messageService.processMessage;

  const originalProcessMessage = messageService.processMessage;
  messageService.processMessage = async function processMessageWithUnifiedRuntime(args = {}) {
    const context = buildContext({
      message: args.message,
      source: 'elan-unified-runtime-whatsapp',
      platform: args.platform,
      channel: args.channel,
      externalUserId: args.externalUserId,
      phone: args.phone,
      metadata: args.metadata && typeof args.metadata === 'object' ? args.metadata : {}
    });

    const intent = context?.owner?.isOwner ? detectAuthorizedPriceLookup(args.message) : null;
    if (!intent) return originalProcessMessage(args);

    try {
      const execution = await executeThroughConnect({
        channel: context?.channel || args.channel || 'whatsapp',
        actor: {
          role: 'owner',
          actorId: 'owner',
          authority: 'owner_identity',
          phone: context?.phone || args.phone || null,
          scopes: ['*'],
          platforms: ['*']
        },
        tool: intent.tool,
        arguments: intent.arguments
      });
      const reply = formatAuthorizedPriceResult(execution);
      console.log('[ELAN_UNIFIED_RUNTIME_EXECUTE]', { channel: 'whatsapp', tool: intent.tool, status: execution?.result?.status || 'OK' });
      return runtimeResult({ args, context, execution, reply });
    } catch (error) {
      console.error('[ELAN_UNIFIED_RUNTIME_FAILED]', { channel: 'whatsapp', tool: intent.tool, code: error?.code || null });
      return runtimeResult({
        args,
        context,
        execution: { actor: { role: 'owner', actorId: 'owner', scopes: ['*'] }, version: '1.0.0' },
        reply: `No pude consultar la autoridad comercial de CONNECT. Error: ${error?.code || 'ELAN_RUNTIME_EXECUTION_FAILED'}. No voy a inventar un precio.`
      });
    }
  };

  Object.defineProperty(messageService, INSTALL_MARK, { value: true, enumerable: false, configurable: false, writable: false });
  console.log('[ELAN_UNIFIED_RUNTIME_INSTALLED]', { boundary: 'processMessage', channels: ['whatsapp'], authority: 'CONNECT' });
  return messageService.processMessage;
}

module.exports = {
  detectAuthorizedPriceLookup,
  installElanUnifiedRuntimeMessagePatch
};
