'use strict';

const { requestProspecting } = require('./ownerProspectingCommandService');
const { buildContext } = require('./context/contextBuilder');

const INSTALL_MARK = Symbol.for('elankav.ownerSupplierMissionStatusPatch.installed');

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function detectSupplierMissionStatus(message) {
  const text = normalize(String(message || '').replace(/^elan[\s,;:.-]+/i, ''));
  if (!text) return false;

  const asksMissionState = /\b(estado|estatus|avance|como va|como vamos)\b.*\b(mision|investigacion|busqueda)\b/.test(text);
  const asksSupplierCount = /\b(cuantos?|cantidad|cuantos llevas|cuantos tenes|cuantos tienes)\b.*\b(proveedores?|suplidores?)\b/.test(text)
    || /\b(proveedores?|suplidores?)\b.*\b(encontrados?|hallados?|llevas|tenes|tienes)\b/.test(text);
  const explicitSupplierMission = /\b(mision|investigacion|busqueda)\b.*\b(proveedores?|suplidores?)\b/.test(text);

  return asksMissionState || asksSupplierCount || explicitSupplierMission;
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function formatSupplierAudit(audit) {
  const mission = audit && audit.mission;
  if (!mission) return 'Todavía no tengo una misión de búsqueda de proveedores activa.';

  const found = number(mission.companiesFound);
  const target = number(mission.targetCompanies);
  const status = String(mission.status || 'draft');
  const contacts = number(mission.contactsFound);

  const state = status === 'completed'
    ? 'completada'
    : status === 'paused'
      ? 'pausada'
      : status === 'draft'
        ? 'preparada / pendiente de primer lote'
        : 'trabajando';

  return [
    '🔎 Misión de proveedores',
    `Estado: ${status} (${state})`,
    `Encontrados: ${found} de ${target} proveedores`,
    `Contactos públicos registrados: ${contacts}`,
    `ID: ${mission.id || 'sin id'}`,
    '',
    'Contacto comercial: pausado / no autorizado por esta consulta.'
  ].join('\n');
}

function installOwnerSupplierMissionStatusPatch(messageService = require('./messageService')) {
  if (!messageService || typeof messageService.processMessage !== 'function') {
    throw new TypeError('messageService.processMessage no está disponible');
  }
  if (messageService[INSTALL_MARK]) return messageService.processMessage;

  const originalProcessMessage = messageService.processMessage;
  messageService.processMessage = async function processMessageWithSupplierMissionStatus(args = {}) {
    const context = buildContext({
      message: args.message,
      source: 'owner-supplier-mission-status',
      platform: args.platform,
      channel: args.channel,
      externalUserId: args.externalUserId,
      phone: args.phone,
      metadata: args.metadata && typeof args.metadata === 'object' ? args.metadata : {}
    });

    if (!context?.owner?.isOwner || !detectSupplierMissionStatus(args.message)) {
      return originalProcessMessage(args);
    }

    try {
      const audit = await requestProspecting('/api/v1/prospecting/audit', { method: 'GET' });
      return {
        message: String(args.message || '').trim(),
        reply: formatSupplierAudit(audit),
        provider: 'elankav',
        model: 'elankav-owner-supplier-mission-status',
        responseId: null,
        status: 'completed',
        usage: null,
        suppressDelivery: false,
        command: 'business_supplier_mission_status',
        jobId: null,
        ownerCommercialQuery: true,
        ownerCrmCommand: false,
        ownerBusinessCommand: true,
        actorRole: 'owner',
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
          ownerMode: true
        }
      };
    } catch (error) {
      return {
        message: String(args.message || '').trim(),
        reply: `No pude consultar el estado de la misión de proveedores. Error: ${error?.code || error?.message || 'UNKNOWN'}`,
        provider: 'elankav',
        model: 'elankav-owner-supplier-mission-status',
        responseId: null,
        status: 'failed',
        usage: null,
        suppressDelivery: false,
        command: 'business_supplier_mission_status',
        jobId: null,
        ownerCommercialQuery: true,
        ownerCrmCommand: false,
        ownerBusinessCommand: true,
        actorRole: 'owner',
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
          ownerMode: true
        }
      };
    }
  };

  Object.defineProperty(messageService, INSTALL_MARK, {
    value: true,
    enumerable: false,
    configurable: false,
    writable: false
  });

  return messageService.processMessage;
}

module.exports = {
  detectSupplierMissionStatus,
  formatSupplierAudit,
  installOwnerSupplierMissionStatusPatch
};
