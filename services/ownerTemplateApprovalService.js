'use strict';

const { requestProspecting } = require('./ownerProspectingCommandService');

const COMMAND_TYPE = 'business_owner_template_approval';

class OwnerTemplateApprovalError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message || code);
    this.name = 'OwnerTemplateApprovalError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function detectOwnerTemplateApproval(message) {
  const raw = String(message || '').trim().replace(/^elan[\s,;:.-]+/i, '').trim();
  const value = normalize(raw);
  if (!raw) return null;
  const approval = /\b(apruebo|aprobar|aproba|aprobada|aprobado|autorizo|autorizar|autoriza|dale aprobala)\b/.test(value);
  const template = /\b(plantilla|template|correo de prueba|mensaje de prueba|presentacion)\b/.test(value);
  if (!approval || !template) return null;
  return {
    type: COMMAND_TYPE,
    input: {
      raw,
      normalized: value,
      supplier: /\b(proveedor|proveedores|supplier|suppliers)\b/.test(value),
      client: /\b(cliente|clientes|client|clients)\b/.test(value),
      key: (raw.match(/\belanvisual-[a-z0-9._-]+\b/i) || [])[0] || null
    }
  };
}

function hasCompletedEvidence(review) {
  const evidence = Array.isArray(review?.evidence) ? review.evidence : [];
  return ['email', 'whatsapp'].every(channel => evidence.some(item =>
    item?.channel === channel && ['sent', 'delivered'].includes(String(item?.status || ''))
  ));
}

function chooseReview(reviews, input) {
  let rows = (Array.isArray(reviews) ? reviews : []).filter(row => !row?.approved && hasCompletedEvidence(row));
  if (input?.key) rows = rows.filter(row => String(row?.template?.key || '').toLowerCase() === String(input.key).toLowerCase());
  if (input?.supplier) rows = rows.filter(row => /supplier|proveedor/i.test([row?.template?.key, row?.template?.name, row?.template?.segment].join(' ')));
  if (input?.client) rows = rows.filter(row => /client|cliente/i.test([row?.template?.key, row?.template?.name, row?.template?.segment].join(' ')));
  return rows.length === 1 ? rows[0] : null;
}

async function executeOwnerTemplateApproval(command, { requestImpl = requestProspecting } = {}) {
  if (!command || command.type !== COMMAND_TYPE) return { handled: false, outputText: null, result: null };
  const reviews = await requestImpl('/api/v1/prospecting/owner-template-reviews', { method: 'GET' });
  const review = chooseReview(reviews, command.input || {});
  if (!review) {
    throw new OwnerTemplateApprovalError(
      'OWNER_TEMPLATE_APPROVAL_TARGET_AMBIGUOUS',
      'No encontré una única plantilla pendiente con prueba de correo y WhatsApp registrada. Indicá la clave exacta de la plantilla.'
    );
  }
  const approved = await requestImpl(
    '/api/v1/prospecting/templates/' + encodeURIComponent(review.template.id) + '/owner-approve',
    { method: 'POST', body: { approvedBy: 'owner-whatsapp' } }
  );
  return {
    handled: true,
    outputText: `✅ Plantilla aprobada: ${approved?.template?.name || review.template.name} · v${approved?.template?.version || review.template.version}. Queda habilitada únicamente esta versión.`,
    result: approved
  };
}

module.exports = {
  COMMAND_TYPE,
  OwnerTemplateApprovalError,
  chooseReview,
  detectOwnerTemplateApproval,
  executeOwnerTemplateApproval,
  hasCompletedEvidence
};
