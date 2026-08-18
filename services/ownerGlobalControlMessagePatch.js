'use strict';

const messageService = require('./messageService');
const { isOwnerPhone } = require('./ownerNotificationService');
const {
  getOwnerResponseControl,
  parseOwnerResponseControlCommand,
  setOwnerOnlyMode
} = require('./ownerGlobalControlService');

let installed = false;

function ownerIdentity(args = {}) {
  return isOwnerPhone(args.phone || args.externalUserId || args.metadata?.senderRaw || args.metadata?.chatId || '');
}

function isControlStatusRequest(message) {
  const value = String(message || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return /(?:estado|como esta|estas).*(?:respuestas|owner only|modo silencio)|(?:a quien|quienes).*(?:respondes|estas respondiendo)/.test(value);
}

function formatControlReply(control) {
  if (control?.enabled) {
    return [
      '🔒 Modo Owner Only activo.',
      'No responderé automáticamente a clientes, prospectos, proveedores, vendedores ni otros contactos.',
      'Seguiré recibiendo mensajes, guardando contexto, siguiendo encargos y notificándote a vos.'
    ].join('\n');
  }
  return [
    '✅ Respuestas externas habilitadas.',
    'ELAN volvió al modo normal y puede responder según identidad, permisos, handoff y reglas comerciales vigentes.'
  ].join('\n');
}

function installOwnerGlobalControlMessagePatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') {
    throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });
  }

  messageService.processMessage = async function processMessageWithOwnerGlobalControl(args = {}) {
    if (ownerIdentity(args)) {
      const command = parseOwnerResponseControlCommand(args.message);
      if (command) {
        const control = await setOwnerOnlyMode(command.enabled);
        return {
          reply: formatControlReply(control),
          provider: 'elankav',
          model: 'elankav-owner-response-control',
          status: 'completed',
          suppressDelivery: false,
          ownerCrmCommand: true,
          actorRole: 'owner',
          actorId: 'owner',
          accessScopes: ['*'],
          command: { type: 'owner_response_control', enabled: control.enabled, mode: control.mode }
        };
      }
      if (isControlStatusRequest(args.message)) {
        const control = await getOwnerResponseControl();
        return {
          reply: formatControlReply(control),
          provider: 'elankav',
          model: 'elankav-owner-response-control',
          status: 'completed',
          suppressDelivery: false,
          ownerCrmCommand: true,
          actorRole: 'owner',
          actorId: 'owner',
          accessScopes: ['*']
        };
      }
    }
    return previousProcessMessage(args);
  };

  installed = true;
  console.log('[OWNER_GLOBAL_CONTROL_MESSAGE_PATCH_INSTALLED]', { persistent: true, reversible: true });
  return true;
}

module.exports = {
  formatControlReply,
  installOwnerGlobalControlMessagePatch,
  isControlStatusRequest,
  ownerIdentity
};
