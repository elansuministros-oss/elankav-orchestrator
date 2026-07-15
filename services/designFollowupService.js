'use strict';

const {
  createDesignPortalSupabaseAdapter
} = require('../adapters/designPortalSupabaseAdapter');

const CODE_PATTERN = /\bDESIGN-[A-Z0-9]+-[A-Z0-9]+\b/i;

function normalizeIdentity(value) {
  return String(value || '').replace(/\D/g, '');
}

function extractDesignCode(message) {
  return String(message || '').match(CODE_PATTERN)?.[0]?.toUpperCase() || '';
}

function detectAction(message) {
  const value = String(message || '').toLowerCase();
  if (/\b(render|hiperrealista|montaje|fachada real)\b/.test(value)) return 'render';
  if (/\b(cambio|cambios|cambiar|modificar|ajustar|corregir|correccion|corrección)\b/.test(value)) {
    return 'revision';
  }
  return 'status';
}

function extractInstructions(message, code) {
  return String(message || '')
    .replace(new RegExp(code.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'i'), '')
    .replace(/^\s*(?:cambios?|cambiar|modificar|ajustar|corregir|correcci[oó]n|render|hiperrealista|montaje)\s*[:,-]?\s*/i, '')
    .trim();
}

function parseRenderProject(message, row) {
  const value = String(message || '').toLowerCase();
  const requestType = /\bfachada\b/.test(value)
    ? 'fachada'
    : /\br[oó]tulo\b/.test(value)
      ? 'rotulo'
      : ['fachada', 'rotulo'].includes(row.request_type)
        ? row.request_type
        : '';
  const environment = /\binterior\b/.test(value)
    ? 'interior'
    : /\bexterior\b/.test(value)
      ? 'exterior'
      : row.installation_environment || '';
  const dimensions = value.match(/(\d+(?:[.,]\d+)?)\s*(?:m|cm)?\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(m|cm)?/i);

  return {
    requestType,
    environment,
    widthCm: dimensions
      ? Number(dimensions[1].replace(',', '.')) * (dimensions[3] === 'm' ? 100 : 1)
      : row.width_cm,
    heightCm: dimensions
      ? Number(dimensions[2].replace(',', '.')) * (dimensions[3] === 'm' ? 100 : 1)
      : row.height_cm
  };
}

function isAuthorized(row, { phone, externalUserId }) {
  const candidates = [phone, externalUserId]
    .map(normalizeIdentity)
    .filter(Boolean);
  const stored = [row.whatsapp, row.external_user_id]
    .map(normalizeIdentity)
    .filter(Boolean);
  return candidates.some(value => stored.includes(value));
}

function canClaimIdentity(row) {
  const storedExternalId = normalizeIdentity(row.external_user_id);
  const storedWhatsapp = normalizeIdentity(row.whatsapp);
  return !storedExternalId || storedExternalId === storedWhatsapp;
}

function resolveClaimIdentity({ phone, externalUserId }) {
  return normalizeIdentity(externalUserId) || normalizeIdentity(phone);
}

function primaryResult(row) {
  const files = Array.isArray(row.result_files) ? row.result_files : [];
  return files.find(file => file?.path) || null;
}

function versionHistory(row) {
  const history = Array.isArray(row.version_history) ? row.version_history : [];
  const result = primaryResult(row);
  if (!result) return history.slice(-20);
  return [
    ...history,
    {
      revision: Number(row.revision_number || 1),
      workflowStage: row.workflow_stage || 'concept',
      requestType: row.request_type,
      resultFiles: row.result_files,
      designResult: row.design_result,
      completedAt: row.completed_at
    }
  ].slice(-20);
}

async function processDesignFollowup({
  message,
  phone,
  externalUserId,
  adapter = createDesignPortalSupabaseAdapter()
} = {}) {
  const requestCode = extractDesignCode(message);
  if (!requestCode) return { handled: false };

  let row = await adapter.findRequestByCode(requestCode);
  if (row && !isAuthorized(row, { phone, externalUserId }) && canClaimIdentity(row)) {
    const claimIdentity = resolveClaimIdentity({ phone, externalUserId });
    if (claimIdentity && typeof adapter.claimRequestIdentity === 'function') {
      const claimed = await adapter.claimRequestIdentity({
        id: row.id,
        previousExternalUserId: row.external_user_id || null,
        externalUserId: claimIdentity
      });
      if (claimed) row = claimed;
    }
  }

  if (!row || !isAuthorized(row, { phone, externalUserId })) {
    return {
      handled: true,
      completed: false,
      outputText: 'No pude identificar esa solicitud en este WhatsApp. Revisá el código y escribilo nuevamente.'
    };
  }

  const revision = Number(row.revision_number || 1);
  const action = detectAction(message);

  if (action === 'status') {
    const ready = ['review', 'ready'].includes(row.status);
    return {
      handled: true,
      completed: ready,
      outputText: ready
        ? `La versión ${revision} de ${requestCode} está lista.\n\nPara modificarla escribí:\nCAMBIOS ${requestCode}: detalle del cambio\n\nPara convertirla en una presentación real escribí:\nRENDER ${requestCode}: rótulo exterior 100 x 80 cm`
        : `La versión ${revision} de ${requestCode} está en proceso. Te avisaremos por este WhatsApp cuando esté lista.`
    };
  }

  if (!['review', 'ready'].includes(row.status) || !primaryResult(row)) {
    return {
      handled: true,
      completed: false,
      outputText: `La versión actual de ${requestCode} todavía no está lista para solicitar otro cambio.`
    };
  }

  const instructions = extractInstructions(message, requestCode);
  if (!instructions) {
    return {
      handled: true,
      completed: false,
      outputText: action === 'revision'
        ? `Escribí el ajuste después del código. Ejemplo:\nCAMBIOS ${requestCode}: usar fondo blanco y letras rosadas`
        : `Indicá el tipo, lugar y medida. Ejemplo:\nRENDER ${requestCode}: rótulo exterior 100 x 80 cm`
    };
  }

  const prior = primaryResult(row);
  const nextRevision = revision + 1;
  const baseValues = {
    revision_number: nextRevision,
    version_history: versionHistory(row),
    result_files: [],
    design_result: {},
    files: [
      ...(Array.isArray(row.files) ? row.files.filter(file => !['logo', 'reference'].includes(file?.kind)) : []),
      { ...prior, kind: action === 'render' ? 'logo' : 'reference' }
    ]
  };

  let values;
  if (action === 'render') {
    const project = parseRenderProject(message, row);
    if (!project.requestType || !project.environment) {
      return {
        handled: true,
        completed: false,
        outputText: `Indicá si será rótulo o fachada y si es interior o exterior. Ejemplo:\nRENDER ${requestCode}: rótulo exterior 100 x 80 cm`
      };
    }
    values = {
      ...baseValues,
      workflow_stage: 'render',
      request_type: project.requestType,
      installation_environment: project.environment,
      width_cm: project.widthCm || null,
      height_cm: project.heightCm || null,
      has_logo: true,
      needs_logo_design: false,
      design_notes: `Crear un render comercial hiperrealista usando exactamente el logo aprobado, sin cambiar su identidad, texto ni colores. ${instructions}`
    };
  } else {
    values = {
      ...baseValues,
      workflow_stage: 'revision',
      design_notes: instructions,
      needs_logo_design: row.request_type === 'logo'
    };
  }

  const queued = await adapter.queueFollowup(row.id, values);
  if (!queued) {
    return {
      handled: true,
      completed: false,
      outputText: `La solicitud ${requestCode} cambió de estado. Escribí nuevamente el código para consultar su avance.`
    };
  }

  return {
    handled: true,
    completed: true,
    outputText: action === 'render'
      ? `Listo. Estamos creando el render hiperrealista como versión ${nextRevision} de ${requestCode}. Te lo enviaremos por este WhatsApp.`
      : `Listo. Registré los cambios como versión ${nextRevision} de ${requestCode}. Te enviaremos la nueva propuesta por este WhatsApp.`
  };
}

module.exports = {
  canClaimIdentity,
  detectAction,
  extractDesignCode,
  extractInstructions,
  normalizeIdentity,
  processDesignFollowup
};
