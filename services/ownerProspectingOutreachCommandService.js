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
  if (/\bsolo\s+(?:correo|email)\b/.test(normalized)) return 'email_only';
  if (/\bsolo\s+(?:whatsapp|wasap)\b/.test(normalized)) return 'whatsapp_only';
  if (/\b(?:whatsapp|wasap)\s+(?:primero|antes)\b/.test(normalized)) return 'whatsapp_first';
  if (/\b(?:correo|email)\s+(?:primero|antes)\b/.test(normalized)) return 'email_first';
  if (/\bprimero\s+(?:por\s+)?(?:whatsapp|wasap)\b/.test(normalized)) return 'whatsapp_first';
  return 'email_first';
}

function detectOwnerProspectingOutreachCommand(message) {
  const raw = String(message || '').trim().replace(/^elan[\s,;:.-]+/i, '').trim();
  const normalized = normalize(raw);
  if (!raw) return null;

  const outreachIntent =
    /\b(contacta|contactar|envia|enviar|escribe|escribir|manda|mandar)\b/.test(normalized);
  const prospectScope =
    /\b(mision|prospectos?|empresas\s+encontradas|empresas\s+de\s+la\s+mision)\b/.test(normalized);
  const channelIntent =
    /\b(correo|email|whatsapp|wasap|mensajes?)\b/.test(normalized);

  if (!outreachIntent || !prospectScope || !channelIntent) return null;

  const missionIdMatch = raw.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i);
  const missionTargetMatch =
    normalized.match(/\bmision\s+(?:de\s+)?(\d{1,3})\s+(?:prospectos?|empresas)?\b/) ||
    normalized.match(/\bmision\b[^.]{0,80}\b(\d{1,3})\s+(?:prospectos?|empresas)\b/);
  const maxTargetsMatch =
    normalized.match(/\b(?:contacta|contactar|envia|enviar)\s+(?:a\s+)?(\d{1,3})\s+(?:empresas|prospectos)\b/);

  const missionTarget = missionTargetMatch ? Number(missionTargetMatch[1]) : null;
  const maxTargets = maxTargetsMatch ? Number(maxTargetsMatch[1]) : null;
  const minPriority = /\bsolo\s+alta\s+prioridad\b/.test(normalized)
    ? 'ALTA PRIORIDAD'
    : 'MEDIA PRIORIDAD';

  return {
    type: COMMAND_TYPE,
    input: {
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
  return [
    '✅ Outreach Autopilot activado.',
    '',
    'Misión: ' + (mission?.id || campaign?.missionId || 'sin id'),
    'Objetivo de investigación: ' + Number(mission?.targetCompanies || 0) + ' empresas',
    'Máximo de campaña: ' + Number(campaign?.maxTargets || 0) + ' prospectos',
    'Estrategia: ' + String(campaign?.strategy || 'email_first'),
    'Prioridad mínima: ' + String(campaign?.minPriority || 'MEDIA PRIORIDAD'),
    'Estado: ' + String(campaign?.status || 'active'),
    '',
    'Email: ' + (control?.emailOutreachEnabled === true ? 'ON' : 'OFF'),
    'WhatsApp: ' + (control?.whatsappOutreachEnabled === true ? 'ON' : 'OFF'),
    'Outreach general: ' + (control?.outreachEnabled === true ? 'ON' : 'OFF'),
    '',
    'ELAN administrará la cola, dedupe, límites y seguimiento sin contacto manual empresa por empresa.'
  ].join('\n');
}

async function executeOwnerProspectingOutreachCommand(
  command,
  { requestImpl = requestProspecting } = {}
) {
  if (!command || command.type !== COMMAND_TYPE) {
    return { handled: false, outputText: null, result: null };
  }

  const input = command.input || {};
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
      'No encontré una misión Prospecting que coincida con la orden.',
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
    result: { campaign: active, mission, control }
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
  requestedChannels,
  strategyFromText
};
