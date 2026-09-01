'use strict';

const messageService = require('./messageService');
const { createWahaDeliveryAdapter, normalizePhone } = require('../adapters/wahaDeliveryAdapter');
const { recordAuditSafely } = require('./ownerOpsAuditService');
const { publishUnifiedMemoryEventSafely } = require('./connectConversationClient');
const { CANDIDATE_OUTREACH_CAPABILITY } = require('./providerCandidateRelationshipService');

let installed = false;
const DEFAULT_OWNER_PHONE = '50588388940';

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function configuredOwnerPhones() {
  const values = String(process.env.ORCHESTRATOR_OWNER_PHONES || process.env.ORCHESTRATOR_OWNER_PHONE || '')
    .split(',')
    .map(normalizePhone)
    .filter(Boolean);
  return values.length ? values : [DEFAULT_OWNER_PHONE];
}

function rawOwnerIdentity(args = {}) {
  const phone = normalizePhone(args.phone || args.externalUserId || args.metadata?.senderRaw || '');
  return Boolean(phone && configuredOwnerPhones().includes(phone));
}

function extractDirectPhone(message) {
  const match = clean(message).match(/(?:\+?505[\s.-]*)?(\d{4}[\s.-]*\d{4})\b/);
  if (!match) return '';
  return normalizePhone(match[0]);
}

function extractCandidateName(message, phone) {
  const raw = clean(message);
  const phoneIndex = raw.search(/(?:\+?505[\s.-]*)?\d{4}[\s.-]*\d{4}\b/);
  const beforePhone = phoneIndex >= 0 ? raw.slice(0, phoneIndex) : raw;

  const patterns = [
    /(?:escrib(?:i|í)le|escribele|escribe|contacta|contactale|contactá|manda(?:le)?(?:\s+un\s+mensaje)?|envia(?:le)?|envíale)\s+(?:a\s+)?(?:la\s+empresa\s+)?(.+?)\s+(?:al|a|telefono|teléfono|whatsapp)\s*$/i,
    /(?:posible|potencial)\s+proveedor\s+(.+?)\s*$/i,
    /proveedor\s+en\s+evaluaci[oó]n\s+(.+?)\s*$/i
  ];

  for (const pattern of patterns) {
    const match = beforePhone.match(pattern);
    if (clean(match?.[1])) return clean(match[1]).replace(/[,:;.-]+$/g, '').trim();
  }

  const fallback = beforePhone
    .replace(/^.*?(?:escrib(?:i|í)le|escribele|escribe|contacta|contactale|contactá)\s+(?:a\s+)?/i, '')
    .replace(/\s+(?:al|a|telefono|teléfono|whatsapp)\s*$/i, '')
    .trim();

  return fallback && fallback.length <= 80 ? fallback : `Contacto ${String(phone || '').slice(-4)}`;
}

function inferServiceHint(message) {
  const raw = clean(message);
  const match = raw.match(/(?:servicios?\s+(?:de|en)|trabajos?\s+(?:de|en)|se\s+dedican\s+a|hacen)\s+([^.!?\n]{3,180})/i);
  if (match) return clean(match[1]).replace(/\s+(?:y\s+)?(?:quiero|queremos|para|porque)\b[\s\S]*$/i, '').trim();

  const normalized = normalize(raw);
  const known = [];
  if (/\bgypsum\b/.test(normalized)) known.push('Gypsum');
  if (/\bdens\s*glass\b|\bdensglass\b/.test(normalized)) known.push('DensGlass');
  if (/\bpared(?:es)?\s+livian/.test(normalized)) known.push('paredes livianas');
  if (/\bdivision(?:es)?\b/.test(normalized)) known.push('divisiones');
  return known.join(', ');
}

function parseProviderCandidateOutreach(message) {
  const raw = clean(message);
  const normalized = normalize(raw);
  if (!raw) return null;

  const hasOutreachVerb = /\b(escribe|escribile|escribele|contacta|contactale|manda|mandale|envia|enviale)\b/.test(normalized);
  const hasProviderIntent = /\b(posible proveedor|proveedor potencial|proveedor en evaluacion|alianza|aliado|subcontratista|trabajar juntos|servicios que ofrecen|como cobran|forma de cobro)\b/.test(normalized);
  const phone = extractDirectPhone(raw);

  if (!hasOutreachVerb || !hasProviderIntent || !phone) return null;

  const name = extractCandidateName(raw, phone);
  const serviceHint = inferServiceHint(raw);
  return {
    type: 'provider_candidate_outreach',
    relationshipType: 'provider_candidate',
    name,
    phone,
    serviceHint,
    objective: serviceHint
      ? `conocer sus servicios de ${serviceHint}, su forma de trabajo y condiciones comerciales para evaluar proyectos en conjunto`
      : 'conocer sus servicios, su forma de trabajo y condiciones comerciales para evaluar proyectos en conjunto'
  };
}

function buildProviderCandidateOpening(candidate) {
  const serviceLine = candidate.serviceHint
    ? `Erick vio que trabajan con ${candidate.serviceHint} y nos interesa conocer mejor lo que ofrecen.`
    : 'Nos interesa conocer mejor los servicios que ofrecen.';

  return [
    'Hola, buen día.',
    '',
    'Soy ELAN IA, asistente de Erick Cano en ELANVISUAL. Erick me pidió ponerme en contacto con ustedes para explorar si podemos trabajar juntos en algunos proyectos.',
    serviceLine,
    '',
    'Para comenzar, ¿me podrían contar qué servicios realizan actualmente y cómo manejan normalmente sus cotizaciones o forma de cobro: por m², por proyecto, por jornada u otra modalidad?',
    '',
    'Gracias.'
  ].join('\n');
}

function outreachResult(previousResult, candidate, sent) {
  return {
    ...(previousResult && typeof previousResult === 'object' ? previousResult : {}),
    reply: [
      '✅ Primer contacto enviado.',
      '',
      `Contacto: ${candidate.name}`,
      `WhatsApp: +${candidate.phone}`,
      'Relación: posible proveedor / en evaluación',
      candidate.serviceHint ? `Referencia: ${candidate.serviceHint}` : '',
      '',
      'Cuando responda, ELAN continuará esa misma conversación como evaluación de proveedor; no como prospecto de ventas.'
    ].filter(Boolean).join('\n'),
    provider: 'elankav',
    model: 'elankav-provider-candidate-outreach',
    status: 'completed',
    suppressDelivery: false,
    ownerCrmCommand: true,
    actorRole: 'owner',
    actorId: 'owner',
    accessScopes: ['*'],
    command: {
      type: 'provider_candidate_outreach',
      relationshipType: 'provider_candidate',
      name: candidate.name,
      phone: candidate.phone,
      messageId: sent?.messageId || null
    }
  };
}

async function executeProviderCandidateOutreach(candidate, {
  delivery = createWahaDeliveryAdapter(),
  recordAudit = recordAuditSafely,
  publishMemory = publishUnifiedMemoryEventSafely,
  now = () => new Date().toISOString()
} = {}) {
  const text = buildProviderCandidateOpening(candidate);
  const sent = await delivery.sendText({ phone: candidate.phone, text });
  const occurredAt = now();

  await recordAudit({
    capability: CANDIDATE_OUTREACH_CAPABILITY,
    target: 'waha',
    source: 'owner-whatsapp',
    success: true,
    metadata: {
      relationshipType: 'provider_candidate',
      stage: 'evaluation',
      name: candidate.name,
      phone: candidate.phone,
      serviceHint: candidate.serviceHint || null,
      objective: candidate.objective,
      chatId: sent?.chatId || null,
      messageId: sent?.messageId || null
    }
  });

  await publishMemory({
    actorKey: candidate.phone,
    actorRole: 'provider_candidate',
    platform: 'ELANVISUAL',
    sourceChannel: 'whatsapp',
    direction: 'outbound',
    text,
    messageType: 'text',
    externalMessageId: sent?.messageId || null,
    occurredAt
  });

  return { candidate, sent, text };
}

function installOwnerProviderCandidateOutreachMessagePatch() {
  if (installed) return false;
  const previousProcessMessage = messageService.processMessage;
  if (typeof previousProcessMessage !== 'function') {
    throw Object.assign(new Error('MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'), {
      code: 'MESSAGE_SERVICE_PROCESS_MESSAGE_REQUIRED'
    });
  }

  messageService.processMessage = async function processMessageWithProviderCandidateOutreach(args = {}) {
    const command = parseProviderCandidateOutreach(args.message);

    if (command && rawOwnerIdentity(args)) {
      const executed = await executeProviderCandidateOutreach(command);
      return outreachResult(null, command, executed.sent);
    }

    const result = await previousProcessMessage(args);
    if (!command || String(result?.actorRole || '').toLowerCase() !== 'owner') return result;

    const executed = await executeProviderCandidateOutreach(command);
    return outreachResult(result, command, executed.sent);
  };

  installed = true;
  console.log('[OWNER_PROVIDER_CANDIDATE_OUTREACH_PATCH_INSTALLED]', {
    directNumber: true,
    ownerOnly: true,
    automaticProviderCreation: false,
    unifiedMemory: true
  });
  return true;
}

module.exports = {
  buildProviderCandidateOpening,
  executeProviderCandidateOutreach,
  extractCandidateName,
  extractDirectPhone,
  inferServiceHint,
  installOwnerProviderCandidateOutreachMessagePatch,
  parseProviderCandidateOutreach,
  rawOwnerIdentity
};
