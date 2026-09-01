'use strict';

const {
  createChannelDeliveryService
} = require('./channelDeliveryService');

const TEST_IDENTITIES = Object.freeze({
  visual: Object.freeze({
    aliases: Object.freeze(['visual', 'elanvisual', 'elan visual']),
    fromIdentity: 'elanvisual',
    address: 'visual@elankav.com',
    label: 'ELANVISUAL'
  }),
  go: Object.freeze({
    aliases: Object.freeze(['go', 'elan-go', 'elan go']),
    fromIdentity: 'elan-go',
    address: 'go@elankav.com',
    label: 'ELAN GO'
  })
});

function clean(value) {
  return String(value || '').trim().toLowerCase();
}

function resolveTestIdentity(value) {
  const normalized = clean(value);
  for (const item of Object.values(TEST_IDENTITIES)) {
    if (item.aliases.includes(normalized)) return item;
  }
  return null;
}

async function executeOwnerEmailSelfTest({
  identity,
  env = process.env,
  fetchImpl = globalThis.fetch
} = {}) {
  const target = resolveTestIdentity(identity);
  if (!target) {
    const error = new Error('OWNER_EMAIL_TEST_IDENTITY_NOT_ALLOWED');
    error.code = 'OWNER_EMAIL_TEST_IDENTITY_NOT_ALLOWED';
    throw error;
  }

  const service = createChannelDeliveryService({ env, fetchImpl });
  const result = await service.deliver({
    channel: 'email',
    to: target.address,
    subject: `Prueba controlada ${target.label}`,
    text: [
      `Prueba controlada de correo para ${target.label}.`,
      '',
      `Remitente esperado: ${target.address}`,
      `Destino de prueba: ${target.address}`,
      'Ruta: ELAN → ORCHESTRATOR → Resend → Cloudflare Email Routing.',
      '',
      'No responde a una campaña ni activa seguimiento comercial.'
    ].join('\n'),
    fromIdentity: target.fromIdentity
  });

  return Object.freeze({
    capability: 'channels.email-test',
    identity: target.fromIdentity,
    label: target.label,
    address: target.address,
    status: result.status,
    provider: result.provider || null,
    externalRef: result.externalRef || null
  });
}

function formatOwnerEmailSelfTest(result) {
  return [
    '✅ Prueba controlada de correo enviada.',
    `Identidad: ${result.label}`,
    `Desde: ${result.address}`,
    `Hacia: ${result.address}`,
    `Proveedor: ${result.provider || 'email'}`,
    `Estado: ${result.status}`,
    result.externalRef ? `Referencia: ${result.externalRef}` : null,
    '',
    'La recepción debe llegar por Cloudflare Email Routing al Gmail verificado.',
    'No se activaron búsquedas, campañas ni seguimientos.'
  ].filter(Boolean).join('\n');
}

module.exports = {
  TEST_IDENTITIES,
  executeOwnerEmailSelfTest,
  formatOwnerEmailSelfTest,
  resolveTestIdentity
};
