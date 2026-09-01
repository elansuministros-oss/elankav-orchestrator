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

function hasEmail(text) {
  return /\b(correo|correos|email|emails)\b/.test(text);
}

function hasWhatsapp(text) {
  return /\b(whatsapp|whatsap|wasap|wqasap|guasap|mensaje|mensajes)\b/.test(text);
}

function strategyFromText(normalized) {
  const email = hasEmail(normalized);
  const whatsapp = hasWhatsapp(normalized);
  if (/\bsolo\s+(?:por\s+)?(?:correo|correos|email|emails)\b/.test(normalized)) return 'email_only';
  if (/\bsolo\s+(?:por\s+)?(?:whatsapp|whatsap|wasap|wqasap|guasap|mensaje|mensajes)\b/.test(normalized)) return 'whatsapp_only';
  if (whatsapp && !email) return 'whatsapp_only';
  if (email && !whatsapp) return 'email_only';
  if (/\b(?:whatsapp|whatsap|wasap|wqasap|guasap|mensaje|mensajes)\s+(?:primero|antes)\b/.test(normalized)) return 'whatsapp_first';
  if (/\bprimero\s+(?:por\s+)?(?:whatsapp|whatsap|wasap|wqasap|guasap)\b/.test(normalized)) return 'whatsapp_first';
  return 'email_first';
}

function detectOwnerProspectingOutreachCommand(message) {
  const raw = String(message || '').trim().replace(/^elan[\s,;:.-]+/i, '').trim();
  const normalized = normalize(raw);
  if (!raw) return null;

  const pauseIntent = /\b(pausa|pausar|deten|detener|detene|parar|suspende|suspender|frena|frenar)\b/.test(normalized);
  const startIntent = /\b(contacta|contactar|envia|enviar|escribe|escribir|manda|mandar|comenza|comenzar|empieza|empezar|inicia|iniciar|activa|activar|segui|seguir|continua|continuar|reanuda|reanudar)\b/.test(normalized);
  const prospectScope = /\b(mision|prospectos?|empresas?|negocios?|lista|listas|encontrad[oa]s?|investigacion|investigadas?|contactos?|decisores?)\b/.test(normalized);
  const readyScope = /\b(?:las|los|a\s+las|a\s+los)\s+que\s+(?:ya\s+)?(?:esten|estan|quedaron)\s+listas?\b/.test(normalized);
  const channelIntent = hasEmail(normalized) || hasWhatsapp(normalized);

  if (pauseIntent && (prospectScope || channelIntent || /\b(campana|envios|outreach)\b/.test(normalized))) {
    return { type: COMMAND_TYPE, input: { action: 'pause', raw } };
  }

  if (!startIntent || !channelIntent || !(prospectScope || readyScope)) return null;

  const missionIdMatch = raw.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  const missionTargetMatch =
    normalized.match(/\bmision\s+(?:de\s+)?(\d{1,3})\s+(?:prospectos?|empresas)?\b/) ||
    normalized.match(/\bmision\b[^.]{0,80}\b(\d{1,3})\s+(?:prospectos?|empresas)\b/);
  const maxTargetsMatch =
    normalized.match(/\b(?:contacta|contactar|envia|enviar|escribe|escribir|manda|mandar)\s+(?:a\s+)?(\d{1,3})\s+(?:empresas|prospectos|contactos)\b/) ||
    normalized.match(/\b(?:solo|solamente|maximo|hasta)\s+(\d{1,3})\s+(?:empresas|prospectos|contactos)?\b/) ||
    normalized.match(/\b(\d{1,3})\s+(?:empresas|prospectos|contactos)\s+(?:hoy|por\s+ahora)\b/);

  const missionTarget = missionTargetMatch ? Number(missionTargetMatch[1]) : null;
  const maxTargets = maxTargetsMatch ? Number(maxTargetsMatch[1]) : null;
  const minPriority = /\b(solo\s+)?alta\s+prioridad\b/.test(normalized)
    ? 'ALTA PRIORIDAD'
    : 'MEDIA PRIORIDAD';

  return {
    type: COMMAND_TYPE,
    input: {
      action: /\b(reanuda|reanudar|continua|continuar|segui|seguir)\b/.test(normalized) ? 'resume' : 'start',
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
  if (control?.outreachEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_OUTREACH_DISABLED',
      'El envío comercial está apagado. No activé ninguna campaña.'
    );
  }
  if (control?.outreachAutopilotEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_OUTREACH_AUTOPILOT_DISABLED',
      'La ejecución automática está apagada. No activé ninguna campaña.'
    );
  }

  const channels = requestedChannels(strategy);
  if (channels.includes('email') && control?.emailOutreachEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_EMAIL_OUTREACH_DISABLED',
      'El envío por correo está apagado. No activé ninguna campaña.'
    );
  }
  if (channels.includes('whatsapp') && control?.whatsappOutreachEnabled !== true) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_WHATSAPP_OUTREACH_DISABLED',
      'El envío por WhatsApp está apagado. No activé ninguna campaña.'
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
    ['running','partial','draft'].includes(String(row?.status || ''))
  ) || rows.find(row => String(row?.status || '') === 'completed') || null;
}

function formatCampaign(campaign, mission, control) {
  const channels = requestedChannels(campaign?.strategy || 'email_first');
  const channelText = channels.length === 2
    ? (campaign?.strategy === 'whatsapp_first' ? 'WhatsApp primero y luego correo' : 'correo primero y luego WhatsApp')
    : channels[0] === 'whatsapp' ? 'solo WhatsApp' : 'solo correo';
  return [
    '✅ Ya dejé activa la campaña comercial.',
    `Voy a trabajar con las empresas listas de la investigación de ${Number(mission?.targetCompanies || 0)} empresas.`,
    `Máximo de esta campaña: ${Number(campaign?.maxTargets || 0)} empresas.`,
    `Canal: ${channelText}.`,
    'Solo usaré decisores verificados, respetaré dedupe, límites, horario comercial y no contactaré registros bloqueados.',
    control?.outreachAutopilotEnabled === true ? 'La cola quedó activa.' : 'La cola no quedó activa.'
  ].join('\n');
}

async function pauseActiveCampaigns(requestImpl) {
  const active = await requestImpl(
    '/api/v1/prospecting/outreach-campaigns?businessUnit=ELANVISUAL&status=active&limit=100',
    { method: 'GET' }
  );
  const rows = Array.isArray(active) ? active : [];
  for (const campaign of rows) {
    await requestImpl(
      '/api/v1/prospecting/outreach-campaigns/' + encodeURIComponent(campaign.id) + '/pause',
      { method: 'PATCH' }
    );
  }
  return rows;
}

async function executeOwnerProspectingOutreachCommand(
  command,
  { requestImpl = requestProspecting } = {}
) {
  if (!command || command.type !== COMMAND_TYPE) {
    return { handled: false, outputText: null, result: null };
  }

  const input = command.input || {};
  if (input.action === 'pause') {
    const paused = await pauseActiveCampaigns(requestImpl);
    return {
      handled: true,
      outputText: paused.length
        ? `Pausé ${paused.length} campaña(s) activa(s). No saldrán nuevos envíos mientras estén pausadas.`
        : 'No había ninguna campaña comercial activa. No hice cambios adicionales.',
      result: { action: 'pause', paused }
    };
  }

  const control = await requestImpl(
    '/api/v1/prospecting/control-status',
    { method: 'GET' }
  );
  assertControls(control, input.strategy || 'email_first');

  const missions = await requestImpl(
    '/api/v1/prospecting/missions?businessUnit=ELANVISUAL&limit=500',
    { method: 'GET' }
  );
  const mission = chooseMission(missions, input);
  if (!mission) {
    throw new OwnerProspectingOutreachError(
      'PROSPECTING_MISSION_NOT_FOUND',
      'No encontré una investigación comercial que coincida con tu orden.',
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

  const active = await requestImpl(
    '/api/v1/prospecting/outreach-campaigns/' + encodeURIComponent(campaign.id) + '/activate',
    { method: 'POST' }
  );

  return {
    handled: true,
    outputText: formatCampaign(active, mission, control),
    result: { action: input.action || 'start', campaign: active, mission, control }
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
  hasEmail,
  hasWhatsapp,
  pauseActiveCampaigns,
  requestedChannels,
  strategyFromText
};
