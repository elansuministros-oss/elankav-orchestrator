'use strict';

const { requestProspecting } = require('./ownerProspectingCommandService');

const COMMAND_TYPE = 'business_prospecting_outreach_campaign_create';

class OwnerProspectingOutreachError extends Error {
  constructor(code, message, statusCode = 409) {
    super(message || code || 'OWNER_PROSPECTING_OUTREACH_ERROR');
    this.name = 'OwnerProspectingOutreachError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function strategyFromText(normalized) {
  const hasEmail = /\b(?:correo|correos|email|emails)\b/.test(normalized);
  const hasWhatsapp = /\b(?:whatsapp|whatsap|wasap|wqasap|guasap|mensajes?|mesajes?)\b/.test(normalized);
  const bothChannels = /\b(?:ambos|ambas|los dos|las dos|dos vias|dos vias|dos canales|correo y whatsapp|whatsapp y correo|correo whatsapp|whatsapp correo)\b/.test(normalized);

  if (/\bsolo\s+(?:correo|correos|email|emails)\b/.test(normalized)) return 'email_only';
  if (bothChannels) return /\bwhatsapp\b.*\bprimero\b|\bprimero\b.*\bwhatsapp\b/.test(normalized) ? 'whatsapp_first' : 'email_first';
  if (/\bsolo\s+(?:whatsapp|whatsap|wasap|wqasap|guasap)\b/.test(normalized)) return 'whatsapp_only';
  if (/\b(?:whatsapp|whatsap|wasap|wqasap|guasap)\s+(?:primero|antes)\b/.test(normalized)) return 'whatsapp_first';
  if (/\b(?:correo|correos|email|emails)\s+(?:primero|antes)\b/.test(normalized)) return 'email_first';
  if (/\bprimero\s+(?:por\s+)?(?:whatsapp|whatsap|wasap|wqasap|guasap)\b/.test(normalized)) return 'whatsapp_first';
  if (hasEmail && !hasWhatsapp) return 'email_only';
  if (hasWhatsapp && !hasEmail) return 'whatsapp_only';
  return 'email_first';
}

function detectOwnerProspectingOutreachCommand(message) {
  const raw = String(message || '').trim().replace(/^elan[\s,;:.-]+/i, '').trim();
  const normalized = normalize(raw);
  if (!raw) return null;

  const channelIntent =
    /\b(correo|correos|email|emails|whatsapp|whatsap|wasap|wqasap|guasap|mensajes?|mesajes?|dos vias|dos canales|ambos canales|ambas vias)\b/.test(normalized);
  const prospectScope =
    /\b(mision|prospectos?|empresas?|negocios?|investigacion|busqueda|encontradas?|listas?|decisores?|mercadeo|marketing|compras)\b/.test(normalized);
  const otherBusinessScope =
    /\b(cotizaci(?:on|ones)|facturas?|recibos?|proveedores?|vendedores?|clientes?|pedidos?|orden(?:es)?\s+de\s+trabajo)\b/.test(normalized);

  const pauseIntent =
    /\b(pausa|pausar|detene|detener|suspende|suspender|frena|frenar)\b/.test(normalized) &&
    /\b(envios?|correos?|emails?|whatsapp|whatsap|wasap|wqasap|guasap|mensajes?|mesajes?|campana)\b/.test(normalized);

  const resumeIntent =
    /\b(reanuda|reanudar|continua|continuar|segui|seguir|retoma|retomar)\b/.test(normalized) &&
    /\b(envios?|correos?|emails?|whatsapp|whatsap|wasap|wqasap|guasap|mensajes?|mesajes?|campana|empresas?)\b/.test(normalized);

  const startIntent =
    /\b(contacta|contactar|contactale|contactales|envia|enviar|enviale|enviales|escribe|escribir|escribile|escribiles|manda|mandar|mandale|mandales|empieza|empezar|empeza|comenza|comenzar|inicia|iniciar|arranca|arrancar|ataca|atacar|prospecta|prospectar)\b/.test(normalized) &&
    channelIntent;

  if (pauseIntent && !otherBusinessScope) {
    return { type: COMMAND_TYPE, input: { action: 'pause', raw } };
  }

  if (resumeIntent && !otherBusinessScope) {
    return { type: COMMAND_TYPE, input: { action: 'resume', raw } };
  }

  const implicitCurrentMission =
    startIntent &&
    !otherBusinessScope &&
    /\b(empieza|empezar|empeza|comenza|comenzar|inicia|iniciar|arranca|arrancar|ataca|prospecta)\b/.test(normalized);

  if (!startIntent || otherBusinessScope || (!prospectScope && !implicitCurrentMission)) return null;

  const missionIdMatch = raw.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  const missionTargetMatch =
    normalized.match(/\bmision\s+(?:de\s+)?(\d{1,3})\s+(?:prospectos?|empresas)?\b/) ||
    normalized.match(/\bmision\b[^.]{0,80}\b(\d{1,3})\s+(?:prospectos?|empresas)\b/);

  const maxTargetsMatch =
    normalized.match(/\b(?:contacta|contactar|envia|enviar|manda|mandar|escribe|escribir)\s+(?:a\s+)?(\d{1,3})\s+(?:empresas|prospectos)\b/) ||
    normalized.match(/\b(?:solo|solamente|maximo|maximo\s+de|hasta)\s+(\d{1,3})\b/) ||
    normalized.match(/\b(?:empieza|empezar|empeza|comenza|comenzar|inicia|iniciar|arranca|arrancar)\s+(?:con\s+)?(\d{1,3})\b/);

  const missionTarget = missionTargetMatch ? Number(missionTargetMatch[1]) : null;
  const maxTargets = maxTargetsMatch ? Number(maxTargetsMatch[1]) : null;
  const minPriority = /\bsolo\s+alta\s+prioridad\b/.test(normalized)
    ? 'ALTA PRIORIDAD'
    : 'MEDIA PRIORIDAD';

  return {
    type: COMMAND_TYPE,
    input: {
      action: 'start',
      ...(missionIdMatch ? { missionId: missionIdMatch[0] } : {}),
      ...(Number.isInteger(missionTarget) ? { missionTarget } : {}),
      ...(Number.isInteger(maxTargets) ? { maxTargets } : {}),
      strategy: strategyFromText(normalized),
      minPriority,
      requireDecisionMaker: true,
      raw
    }
  };
}

function requestedChannels(strategy) {
  if (strategy === 'email_only') return ['email'];
  if (strategy === 'whatsapp_only') return ['whatsapp'];
  return strategy === 'whatsapp_first' ? ['whatsapp', 'email'] : ['email', 'whatsapp'];
}

function assertControls(control, strategy) {
  if (control?.ownerAuthorizationRequired !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_OWNER_AUTH_GATE_REQUIRED',
      'CONNECT no confirmó el gate de autorización del Owner. No creé ni activé campaña.'
    );
  }
  if (control?.contactWindowEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_CONTACT_WINDOW_REQUIRED',
      'CONNECT no confirmó la ventana horaria de contacto. No creé ni activé campaña.'
    );
  }
  if (control?.outreachEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_OUTREACH_DISABLED',
      'Outreach general está apagado. No creé ni activé campaña.'
    );
  }
  if (control?.outreachAutopilotEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_OUTREACH_AUTOPILOT_DISABLED',
      'Outreach Autopilot está apagado. No creé ni activé campaña.'
    );
  }

  const channels = requestedChannels(strategy);
  if (channels.includes('email') && control?.emailOutreachEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_EMAIL_OUTREACH_DISABLED',
      'Email Outreach está apagado. No creé ni activé campaña.'
    );
  }
  if (channels.includes('whatsapp') && control?.whatsappOutreachEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_WHATSAPP_OUTREACH_DISABLED',
      'WhatsApp Outreach está apagado. No creé ni activé campaña.'
    );
  }
}

function chooseMission(missions, input) {
  const rows = Array.isArray(missions) ? missions : [];
  if (input.missionId) {
    return rows.find(row => String(row?.id || '') === String(input.missionId)) || null;
  }

  if (Number.isInteger(input.missionTarget)) {
    return rows.find(row =>
      Number(row?.targetCompanies || 0) === Number(input.missionTarget) &&
      ['draft','running','partial','completed'].includes(String(row?.status || ''))
    ) || null;
  }

  return rows.find(row =>
    ['draft','running','partial','completed'].includes(String(row?.status || ''))
  ) || null;
}

function formatCampaign(campaign, mission, control) {
  const strategyLabel = campaign?.strategy === 'email_only'
    ? 'solo correo'
    : campaign?.strategy === 'whatsapp_only'
      ? 'solo WhatsApp'
      : campaign?.strategy === 'whatsapp_first'
        ? 'WhatsApp primero y luego correo'
        : 'correo primero y luego WhatsApp';

  return [
    '✅ Ya empecé.',
    `Voy a contactar como máximo ${Number(campaign?.maxTargets || 0)} empresas de la investigación actual.`,
    `Canal: ${strategyLabel}.`,
    'Solo usaré decisores verificados y respetaré bloqueos, deduplicación, límites y seguimiento.',
    `Objetivo de investigación: ${Number(mission?.targetCompanies || 0)} empresas.`,
    `Estado: ${String(campaign?.status || 'active')}.`,
    control?.emailOutreachEnabled === true ? 'Correo habilitado.' : '',
    control?.whatsappOutreachEnabled === true ? 'WhatsApp habilitado.' : '',
    control?.contactWindowEnabled === true
      ? `Horario permitido: ${Number(control?.contactStartHour ?? 8)}:00–${Number(control?.contactEndHour ?? 18)}:00 (${String(control?.contactTimeZone || 'America/Managua')}).`
      : '',
    control?.followupsEnabled === true
      ? 'Seguimientos automáticos habilitados.'
      : 'Seguimientos automáticos desactivados; registraré respuestas y te reportaré qué prospectos requieren atención.'
  ].filter(Boolean).join('\n');
}

function formatPaused(count) {
  return count > 0
    ? `⏸️ Pausé ${count} campaña(s) de contacto. No se enviarán nuevos mensajes mientras estén pausadas.`
    : 'No había ninguna campaña activa que pausar.';
}

function formatResumed(campaign) {
  return campaign
    ? `▶️ Reanudé la campaña de contacto. Estado: ${campaign.status}. Continúo respetando dedupe, decisores verificados, límites y respuestas.`
    : 'No encontré una campaña pausada para reanudar.';
}

async function executeOwnerProspectingOutreachCommand(
  command,
  { requestImpl = requestProspecting } = {}
) {
  if (!command || command.type !== COMMAND_TYPE) {
    return { handled: false, outputText: null, result: null };
  }

  const input = command.input || {};
  const action = String(input.action || 'start');

  if (action === 'pause') {
    const active = await requestImpl(
      '/api/v1/prospecting/outreach-campaigns?businessUnit=ELANVISUAL&status=active&limit=500',
      { method: 'GET' }
    );
    const rows = Array.isArray(active) ? active : [];
    const paused = [];
    for (const campaign of rows) {
      paused.push(await requestImpl(
        '/api/v1/prospecting/outreach-campaigns/' + encodeURIComponent(campaign.id) + '/pause',
        { method: 'PATCH' }
      ));
    }
    return {
      handled: true,
      outputText: formatPaused(paused.length),
      result: { action, campaigns: paused }
    };
  }

  const control = await requestImpl(
    '/api/v1/prospecting/control-status',
    { method: 'GET' }
  );

  if (action === 'resume') {
    const paused = await requestImpl(
      '/api/v1/prospecting/outreach-campaigns?businessUnit=ELANVISUAL&status=paused&limit=500',
      { method: 'GET' }
    );
    const campaign = Array.isArray(paused) ? paused[0] : null;
    if (!campaign) {
      return {
        handled: true,
        outputText: formatResumed(null),
        result: { action, campaign: null, control }
      };
    }
    assertControls(control, campaign.strategy || 'email_first');
    const active = await requestImpl(
      '/api/v1/prospecting/outreach-campaigns/' + encodeURIComponent(campaign.id) + '/activate',
      { method: 'POST' }
    );
    return {
      handled: true,
      outputText: formatResumed(active),
      result: { action, campaign: active, control }
    };
  }

  assertControls(control, input.strategy || 'email_first');

  const missions = await requestImpl(
    '/api/v1/prospecting/missions?businessUnit=ELANVISUAL&limit=500',
    { method: 'GET' }
  );
  const mission = chooseMission(missions, input);
  if (!mission) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_MISSION_NOT_FOUND',
      'No encontré una investigación comercial activa que coincida con la orden.',
      404
    );
  }

  const maxTargets = Math.max(
    1,
    Math.min(
      500,
      Number(input.maxTargets || mission.targetCompanies || 100)
    )
  );

  const campaign = await requestImpl(
    '/api/v1/prospecting/outreach-campaigns',
    {
      method: 'POST',
      body: {
        businessUnit: 'ELANVISUAL',
        missionId: mission.id,
        name: 'Outreach ELANVISUAL · ' + String(mission.targetCompanies || maxTargets),
        strategy: input.strategy || 'email_first',
        maxTargets,
        minPriority: input.minPriority || 'MEDIA PRIORIDAD',
        requireDecisionMaker: true,
        autoApprovePresentations: true,
        createdBy: 'owner-whatsapp'
      }
    }
  );

  await requestImpl(
    '/api/v1/prospecting/outreach-campaigns/' + encodeURIComponent(campaign.id) + '/prepare',
    { method: 'POST' }
  );

  const active = await requestImpl(
    '/api/v1/prospecting/outreach-campaigns/' + encodeURIComponent(campaign.id) + '/activate',
    { method: 'POST' }
  );

  return {
    handled: true,
    outputText: formatCampaign(active, mission, control),
    result: { action, campaign: active, mission, control }
  };
}

module.exports = {
  COMMAND_TYPE,
  OwnerProspectingOutreachError,
  assertControls,
  chooseMission,
  detectOwnerProspectingOutreachCommand,
  executeOwnerProspectingOutreachCommand,
  formatCampaign,
  formatPaused,
  formatResumed,
  requestedChannels,
  strategyFromText
};
