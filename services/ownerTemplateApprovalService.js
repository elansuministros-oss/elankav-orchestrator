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

  const template = /\b(plantilla|plantillas|template|templates|correo de prueba|mensaje de prueba|presentacion|presentaciones)\b/.test(value);
  if (!template) return null;

  const approval = /\b(apruebo|aprobar|aproba|aprobala|aprobalo|aprobada|aprobado|autorizo|autorizar|autoriza|dale aprobala)\b/.test(value);
  const preview = /\b(enviame|envia|enviar|mandame|manda|mandar|prueba|probar|validar|valida|revisar|revisa|mostrar|mostrame|ver)\b/.test(value) &&
    /\b(prueba|plantilla|template|presentacion|correo|whatsapp|validar|revisar|ver)\b/.test(value);

  if (!approval && !preview) return null;

  return {
    type: COMMAND_TYPE,
    input: {
      action: approval ? 'approve' : 'preview',
      raw,
      normalized: value,
      supplier: /\b(proveedor|proveedores|supplier|suppliers)\b/.test(value),
      client: /\b(cliente|clientes|client|clients)\b/.test(value),
      prospect: /\b(prospecto|prospectos|prospect|prospects)\b/.test(value),
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

function matchesAudience(row, input) {
  const haystack = [row?.template?.key, row?.template?.name, row?.template?.segment, row?.template?.metadata?.audience]
    .join(' ');
  if (input?.supplier && !/supplier|proveedor/i.test(haystack)) return false;
  if (input?.client && !/client|cliente/i.test(haystack)) return false;
  if (input?.prospect && /supplier|proveedor|client|cliente/i.test(haystack)) return false;
  return true;
}

function chooseReview(reviews, input, { requireEvidence = true } = {}) {
  let rows = (Array.isArray(reviews) ? reviews : []).filter(row => !row?.approved);
  if (requireEvidence) rows = rows.filter(hasCompletedEvidence);
  if (input?.key) rows = rows.filter(row => String(row?.template?.key || '').toLowerCase() === String(input.key).toLowerCase());
  rows = rows.filter(row => matchesAudience(row, input));
  return rows.length === 1 ? rows[0] : null;
}

async function executeOwnerTemplateApproval(command, { requestImpl = requestProspecting } = {}) {
  if (!command || command.type !== COMMAND_TYPE) return { handled: false, outputText: null, result: null };
  const input = command.input || {};
  const reviews = await requestImpl('/api/v1/prospecting/owner-template-reviews', { method: 'GET' });

  if (input.action === 'preview') {
    const review = chooseReview(reviews, input, { requireEvidence: false });
    if (!review) {
      throw new OwnerTemplateApprovalError(
        'OWNER_TEMPLATE_PREVIEW_TARGET_AMBIGUOUS',
        'No encontré una única plantilla pendiente para esa descripción. Indicá si es de proveedores, prospectos o clientes, o escribí la clave exacta de la plantilla.'
      );
    }
    const tested = await requestImpl(
      '/console/api/prospecting/templates/' + encodeURIComponent(review.template.id) + '/owner-test',
      { method: 'POST' }
    );
    return {
      handled: true,
      outputText: `✅ Prueba Owner enviada: ${review.template.name} · v${review.template.version}. Revisá tu correo y tu WhatsApp. No queda aprobada hasta que vos lo ordenés.`,
      result: tested
    };
  }

  const review = chooseReview(reviews, input, { requireEvidence: true });
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
  hasCompletedEvidence,
  matchesAudience
};
