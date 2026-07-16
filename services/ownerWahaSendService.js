'use strict';

const {
  createWahaDeliveryAdapter,
  normalizePhone
} = require('../adapters/wahaDeliveryAdapter');

const DESIGN_PORTAL_URL = 'https://visual.elankav.com/diseno/whatsapp';

function extractPhone(message) {
  const matches = String(message || '').match(/(?:\+?505[\s().-]*)?\d{4}[\s.-]*\d{4}/g) || [];
  return matches.map(normalizePhone).find(Boolean) || '';
}

function buildDesignLinkMessage() {
  return [
    'Hola.',
    '',
    'Te compartimos el enlace oficial de ELANVISUAL para completar tu solicitud de diseño:',
    DESIGN_PORTAL_URL,
    '',
    'Al enviarla recibirás un código de seguimiento.'
  ].join('\n');
}

async function sendDesignLink({ phone, delivery } = {}) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) {
    const error = new Error('OWNER_WAHA_PHONE_REQUIRED');
    error.code = 'OWNER_WAHA_PHONE_REQUIRED';
    throw error;
  }

  const adapter = delivery || createWahaDeliveryAdapter();
  const sent = await adapter.sendText({
    phone: normalizedPhone,
    text: buildDesignLinkMessage()
  });

  return Object.freeze({
    phone: normalizedPhone,
    chatId: sent.chatId,
    messageId: sent.messageId || null,
    link: DESIGN_PORTAL_URL
  });
}

module.exports = {
  DESIGN_PORTAL_URL,
  buildDesignLinkMessage,
  extractPhone,
  sendDesignLink
};
