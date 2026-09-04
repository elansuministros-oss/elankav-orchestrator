'use strict';

const { requestProspecting } = require('./ownerProspectingCommandService');

const COMMAND_TYPE = 'business_prospecting_natural_audit';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cleanOwnerPrefix(value) {
  return String(value || '').trim().replace(/^elan[\s,;:.-]+/i, '').trim();
}

function detectOwnerProspectingNaturalAudit(message) {
  const raw = cleanOwnerPrefix(message);
  const text = normalize(raw);
  if (!text) return null;

  const asksCompanies =
    /\b(cuantas?\s+(?:empresas|negocios|prospectos?)\s+(?:encontraste|encontrastes|hallaste|llevas|tenes|tienes)|como\s+(?:vamos|va)\s+(?:con\s+)?(?:las\s+)?empresas|como\s+va\s+(?:la\s+)?(?:investigacion|busqueda)|que\s+has\s+encontrado)\b/.test(text);

  const asksEmail =
    /\b(cuantos?\s+(?:correos?|emails?)|a\s+cuantos?\s+.*(?:correo|email)|(?:enviaste|mandaste|escribiste)\s+.*(?:correo|email)|por\s+(?:correo|email)\s+a\s+cuantos?)\b/.test(text);

  const asksWhatsapp =
    /\b(cuantos?\s+(?:whatsapp|wasap|mensajes?\s+de\s+whatsapp)|a\s+cuantos?\s+.*(?:whatsapp|whatsap|wasap|wqasap|guasap)|(?:enviaste|mandaste|escribiste)\s+.*(?:whatsapp|whatsap|wasap|wqasap|guasap)|por\s+(?:whatsapp|whatsap|wasap|wqasap|guasap)\s+a\s+cuantos?)\b/.test(text);

  const asksResponses =
    /\b(que\s+te\s+han\s+dicho|que\s+respondieron|quien(?:es)?\s+respondio|quien(?:es)?\s+respondieron|hay\s+alguna\s+respuesta|hay\s+respuestas|alguno\s+respondio|alguien\s+respondio|te\s+respondieron|han\s+respondido)\b/.test(text);

  const asksFollowup =
    /\b(seguimiento|dando\s+seguimiento|a\s+quien(?:es)?\s+.*seguimiento|quien(?:es)?\s+.*pendientes?|a\s+quien(?:es)?\s+.*pendiente)\b/.test(text);

  const asksComplaints =
    /\b(spam|molest|molesto|molesta|molestaron|queja|se\s+ha\s+molestado|se\s+han\s+molestado|no\s+quieren\s+que\s+(?:les\s+)?escrib|pidio\s+que\s+no\s+le\s+escrib|bloque)\b/.test(text);

  const asksImprove =
    /\b(que\s+podemos\s+hacer\s+para\s+mejorar|como\s+podemos\s+mejorar|como\s+lo\s+mejoramos|que\s+recomendas|que\s+recomiendas|como\s+mejoramos|que\s+cambiarias)\b/.test(text);

  const asksInterest =
    /\b(hay\s+alguien\s+interesad[oa]s?|hay\s+alguno\s+interesad[oa]s?|quien(?:es)?\s+esta(?:n)?\s+interesad[oa]s?|algun\s+interesad[oa]?|ves\s+interes)\b/.test(text);

  const asksBroad =
    /\b(como\s+va\s+todo\s+(?:con\s+)?(?:las\s+)?empresas|como\s+vamos\s+con\s+todo|contame\s+como\s+va|cuentame\s+como\s+va)\b/.test(text);

  // Explicit Owner requests such as "dame la auditoría de prospecting de hoy para ELANVISUAL"
  // must never fall through to the generic platform-health answer. These requests are read-only
  // and are resolved against CONNECT's real Prospecting audit endpoint below.
  const asksAudit =
    /\b(?:auditoria|reporte|resumen|balance|estado)\b.*\b(?:prospecting|prospeccion|prospectos?)\b|\b(?:prospecting|prospeccion)\b.*\b(?:auditoria|reporte|resumen|balance|estado)\b/.test(text);

  if (!(asksCompanies || asksEmail || asksWhatsapp || asksResponses || asksFollowup ||
        asksComplaints || asksImprove || asksInterest || asksBroad || asksAudit)) return null;

  let intent = 'overview';
  if (asksImprove) intent = 'improve';
  else if (asksComplaints) intent = 'complaints';
  else if (asksResponses) intent = 'responses';
  else if (asksFollowup) intent = 'followup';
  else if (asksInterest) intent = 'interest';
  else if (asksEmail && !asksWhatsapp) intent = 'email';
  else if (asksWhatsapp && !asksEmail) intent = 'whatsapp';
  else if (asksCompanies && !asksBroad) intent = 'research';

  return {
    type: COMMAND_TYPE,
    input: { intent, raw }
  };
}

function number(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function missionLine(audit) {
  const m = audit?.mission;
  if (!m) return 'Todavía no tengo una investigación comercial activa para ELANVISUAL.';
  const state = m.status === 'completed'
    ? 'La investigación ya terminó.'
    : m.status === 'paused'
      ? 'La investigación está pausada.'
      : 'La investigación sigue trabajando.';
  return [
    `He encontrado ${number(m.companiesFound)} de ${number(m.targetCompanies)} empresas.`,
    `Tengo ${number(m.contactsFound)} contactos, ${number(m.decisionMakersFound)} decisores y ${number(m.readyForContact)} empresas listas para contactar.`,
    number(m.companiesWithoutDecision) > 0
      ? `Todavía me faltan decisores utilizables en ${number(m.companiesWithoutDecision)} empresas.`
      : '',
    state
  ].filter(Boolean).join(' ');
}

function attributionNote(audit) {
  return audit?.attribution?.externalInboundAttributionComplete === true
    ? ''
    : 'Ojo: las respuestas que todavía no hayan sido atribuidas automáticamente desde correo o WhatsApp a Prospecting no entran en este conteo.';
}

function latestResponseLines(audit, limit = 4, predicate = null) {
  const base = Array.isArray(audit?.outreach?.latestResponses)
    ? audit.outreach.latestResponses
    : [];
  const rows = (typeof predicate === 'function' ? base.filter(predicate) : base).slice(0, limit);
  if (!rows.length) return [];
  return rows.map((row, index) => {
    const company = row.companyName || 'empresa sin nombre';
    const summary = row.responseSummary || row.messageExcerpt || 'respuesta registrada';
    return `${index + 1}. ${company}: ${summary}`;
  });
}

function improvementLines(audit) {
  const m = audit?.mission || {};
  const o = audit?.outreach || {};
  const lines = [];

  if (number(m.companiesWithoutDecision) > 0) {
    lines.push(`Seguir profundizando Mercadeo y Compras: todavía hay ${number(m.companiesWithoutDecision)} empresas sin un decisor utilizable.`);
  }

  const readyNotContacted = Math.max(0, number(m.readyForContact) - number(o.contactedCompanies));
  if (readyNotContacted > 0) {
    lines.push(`Hay ${readyNotContacted} empresas listas que todavía no tienen un contacto enviado desde esta misión.`);
  }

  if (number(o.totalSent) === 0) {
    lines.push('Todavía no hay volumen de envíos suficiente para medir qué mensaje o canal convierte mejor.');
  } else if (number(o.responses) === 0) {
    lines.push('Ya hubo envíos pero todavía no hay respuestas registradas; antes de escalar conviene revisar asunto, mensaje, decisor y horario.');
  } else {
    lines.push(`La tasa registrada de respuesta es ${number(o.responseRatePct)}%. Podemos comparar correo contra WhatsApp y Mercadeo contra Compras antes de escalar.`);
  }

  if (number(o.negativeSignals) > 0) {
    lines.push(`Detecté ${number(o.negativeSignals)} respuesta(s) con señales negativas; conviene revisar esos casos antes de aumentar frecuencia.`);
  }

  if (audit?.attribution?.externalInboundAttributionComplete !== true) {
    lines.push('También conviene cerrar la atribución automática de respuestas entrantes para que ningún correo o WhatsApp respondido quede fuera del reporte.');
  }

  return lines;
}

function formatAudit(audit, intent) {
  const m = audit?.mission;
  const o = audit?.outreach || {};

  if (!m) return 'Todavía no tengo una investigación comercial activa para ELANVISUAL.';

  if (intent === 'research') return missionLine(audit);

  if (intent === 'email') {
    return [
      `De esta investigación he enviado ${number(o.emailsSent)} correo(s) a ${number(o.contactedCompanies)} empresa(s) contactadas en total.`,
      number(o.responses) > 0 ? `Tengo ${number(o.emailResponses)} respuesta(s) registradas por correo.` : 'No tengo respuestas por correo registradas todavía.',
      attributionNote(audit)
    ].filter(Boolean).join(' ');
  }

  if (intent === 'whatsapp') {
    return [
      `De esta investigación he enviado ${number(o.whatsappSent)} WhatsApp.`,
      number(o.whatsappResponses) > 0 ? `Tengo ${number(o.whatsappResponses)} respuesta(s) registradas por WhatsApp.` : 'No tengo respuestas por WhatsApp registradas todavía.',
      attributionNote(audit)
    ].filter(Boolean).join(' ');
  }

  if (intent === 'responses') {
    const lines = [
      number(o.responses) > 0
        ? `Tengo ${number(o.responses)} empresa(s) con respuesta registrada: ${number(o.emailResponses)} por correo y ${number(o.whatsappResponses)} por WhatsApp.`
        : 'Todavía no tengo respuestas atribuidas a esta investigación.',
      ...latestResponseLines(audit),
      attributionNote(audit)
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (intent === 'followup') {
    return [
      `Tengo ${number(o.pendingFollowups)} seguimiento(s) pendientes y ya se enviaron ${number(o.followupsSent)} seguimiento(s).`,
      number(o.failed) > 0 ? `Hay ${number(o.failed)} envío(s) fallido(s) que requieren revisión.` : '',
      number(o.responses) > 0 ? `${number(o.responses)} empresa(s) ya respondieron y no deberían seguir recibiendo la misma secuencia.` : ''
    ].filter(Boolean).join(' ');
  }

  if (intent === 'complaints') {
    const lines = [
      number(o.negativeSignals) > 0
        ? `Sí veo ${number(o.negativeSignals)} respuesta(s) con señales de molestia, rechazo, spam o solicitud de no contacto.`
        : 'No tengo registrada ninguna respuesta con señales de molestia, spam o solicitud de no contacto.',
      ...latestResponseLines(audit, 3, row => row.negativeSignal === true),
      attributionNote(audit)
    ];
    return lines.filter(Boolean).join('\n');
  }

  if (intent === 'interest') {
    return [
      number(o.positiveSignals) > 0
        ? `Veo ${number(o.positiveSignals)} respuesta(s) con señales positivas, como interés, solicitud de información, precio, propuesta o contacto.`
        : 'Todavía no tengo respuestas registradas con señales claras de interés.',
      ...latestResponseLines(audit, 4, row => row.positiveSignal === true),
      attributionNote(audit)
    ].filter(Boolean).join('\n');
  }

  if (intent === 'improve') {
    return ['Lo que mejoraría ahora:', ...improvementLines(audit).map((x, i) => `${i + 1}. ${x}`)].join('\n');
  }

  return [
    missionLine(audit),
    `Hasta ahora: ${number(o.emailsSent)} correo(s), ${number(o.whatsappSent)} WhatsApp, ${number(o.responses)} respuesta(s) registrada(s), ${number(o.pendingFollowups)} seguimiento(s) pendiente(s).`,
    number(o.negativeSignals) > 0
      ? `Hay ${number(o.negativeSignals)} señal(es) negativa(s) que conviene revisar.`
      : 'No tengo señales registradas de molestia o spam.',
    attributionNote(audit)
  ].filter(Boolean).join('\n');
}

async function executeOwnerProspectingNaturalAudit(
  command,
  { requestImpl = requestProspecting } = {}
) {
  if (!command || command.type !== COMMAND_TYPE) {
    return { handled: false, outputText: null, result: null };
  }

  const audit = await requestImpl('/api/v1/prospecting/audit', { method: 'GET' });
  const intent = String(command.input?.intent || 'overview');

  return {
    handled: true,
    outputText: formatAudit(audit, intent),
    result: { audit, intent }
  };
}

module.exports = {
  COMMAND_TYPE,
  detectOwnerProspectingNaturalAudit,
  executeOwnerProspectingNaturalAudit,
  formatAudit,
  improvementLines
};