'use strict';

const commandService = require('./elanUnifiedOwnerCommandService');

const previousDetect = commandService.detectOwnerUnifiedCommand;

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function phoneFromMessage(raw) {
  const match = String(raw || '').match(
    /(?:whatsapp|wasap|telefono|teléfono|celular|n[uú]mero(?:\s+de\s+whatsapp)?)\s*(?:es|:|=)?\s*(\+?[\d\s-]{8,})/i
  );
  return String(match?.[1] || '').trim();
}

function sellerMutationPriority(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!/\b(vendedor|vendedora|vendedores|vendedoras)\b/.test(text)) return null;

  const phone = phoneFromMessage(raw);

  if (/\b(elimina|eliminar|borra|borrar)\b/.test(text)) {
    if (!phone) return null;
    return {
      sellerPreview: true,
      action: 'delete',
      query: phone,
      tool: 'previsualizar_eliminar_vendedor'
    };
  }

  if (/\b(desactiva|desactivar)\b/.test(text)) {
    if (!phone) return null;
    return {
      sellerPreview: true,
      action: 'deactivate',
      query: phone,
      tool: 'previsualizar_desactivar_vendedor'
    };
  }

  return null;
}

commandService.detectOwnerUnifiedCommand = function detectSellerMutationBeforeReadOnly(message) {
  return sellerMutationPriority(message) || previousDetect(message);
};

module.exports = { sellerMutationPriority, phoneFromMessage };
