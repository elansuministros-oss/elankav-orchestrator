'use strict';

const messageService = require('./messageService');
const { normalizeHumanMessage } = require('./humanLanguageInterpreter');

let installed = false;

function installHumanLanguageMessagePatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') {
    throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), { code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED' });
  }

  messageService.processMessage = async function processMessageWithHumanLanguage(args = {}) {
    const originalMessage = String(args?.message || '');
    const normalizedMessage = normalizeHumanMessage(originalMessage);
    const result = await previousProcessMessage({
      ...args,
      message: normalizedMessage,
      originalMessage
    });
    if (!result || typeof result !== 'object') return result;
    return {
      ...result,
      message: originalMessage || result.message,
      humanNormalizedMessage: normalizedMessage !== originalMessage ? normalizedMessage : null
    };
  };

  installed = true;
  console.log('[HUMAN_LANGUAGE_MESSAGE_PATCH_INSTALLED]', {
    typoTolerance: true,
    preservesOriginalMessage: true,
    businessRoutingNormalization: true
  });
  return true;
}

module.exports = { installHumanLanguageMessagePatch };
