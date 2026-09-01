'use strict';

const { listJobs } = require('./jobs/jobQueue');

const CANDIDATE_OUTREACH_CAPABILITY = 'business.provider-candidate.outreach.send';
const DEFAULT_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value || '').trim();
}

function normalizePhone(value) {
  const digits = clean(value).split('@')[0].replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function candidateAuditFromJob(job) {
  const audit = job?.result?.audit;
  if (!audit || typeof audit !== 'object') return null;
  const capability = clean(audit.capability || job?.task);
  if (capability !== CANDIDATE_OUTREACH_CAPABILITY) return null;
  if (audit.success === false || clean(job?.status).toLowerCase() === 'failed') return null;

  const metadata = audit.metadata && typeof audit.metadata === 'object' ? audit.metadata : {};
  const phone = normalizePhone(metadata.phone || metadata.whatsapp || metadata.chatId);
  if (!phone) return null;

  return {
    capability,
    relationshipType: 'provider_candidate',
    stage: clean(metadata.stage) || 'evaluation',
    name: clean(metadata.name || metadata.providerName || metadata.contactName) || `Contacto ${phone.slice(-4)}`,
    phone,
    serviceHint: clean(metadata.serviceHint),
    objective: clean(metadata.objective) || 'explorar una posible relación como proveedor o aliado',
    createdAt: clean(audit.createdAt || job?.createdAt),
    chatId: clean(metadata.chatId),
    messageId: clean(metadata.messageId)
  };
}

function candidateMatches(audit, { phone, name } = {}) {
  if (!audit) return false;
  const wantedPhone = normalizePhone(phone);
  if (wantedPhone && audit.phone === wantedPhone) return true;

  const wantedName = normalizeName(name);
  const auditName = normalizeName(audit.name);
  return Boolean(wantedName && auditName && (
    wantedName === auditName || auditName.includes(wantedName) || wantedName.includes(auditName)
  ));
}

function findLatestProviderCandidate(jobs, {
  phone,
  name,
  now = Date.now(),
  maxAgeMs = DEFAULT_MAX_AGE_MS
} = {}) {
  return (Array.isArray(jobs) ? jobs : [])
    .map(candidateAuditFromJob)
    .filter(Boolean)
    .filter(item => candidateMatches(item, { phone, name }))
    .filter(item => {
      const timestamp = Date.parse(item.createdAt);
      return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}

async function resolveProviderCandidateRelationship(
  { phone, name, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {},
  { listJobsImpl = listJobs } = {}
) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone && !clean(name)) return null;
  const jobs = await listJobsImpl();
  return findLatestProviderCandidate(jobs, {
    phone: normalizedPhone,
    name,
    now,
    maxAgeMs
  });
}

function buildProviderCandidateInstructions(candidate) {
  const name = clean(candidate?.name) || 'este contacto';
  const serviceHint = clean(candidate?.serviceHint);
  const objective = clean(candidate?.objective) || 'evaluar una posible relación de trabajo';

  return [
    `El remitente es ${name}, una relación PROVIDER_CANDIDATE iniciada por orden del Owner Erick Cano.`,
    `Objetivo de la relación: ${objective}.`,
    serviceHint ? `Referencia inicial de servicios: ${serviceHint}.` : '',
    'No lo trates como cliente, lead o prospecto y no le vendas servicios de ELANVISUAL.',
    'Presentate como ELAN IA, asistente de Erick Cano / ELANVISUAL, únicamente si hace falta contextualizar quién sos.',
    'Continuá la conversación de manera coherente para conocer qué servicios ofrece, cobertura, capacidad, tiempos, modalidad de cotización, precios o forma de cobro, qué incluyen sus precios, materiales/mano de obra y condiciones comerciales.',
    'Hacé preguntas naturales y relevantes según lo que vaya respondiendo; no repitas preguntas ya contestadas.',
    'Si indica que cobra por m², por proyecto, por jornada u otra unidad, tomalo como información del posible proveedor y profundizá en qué incluye y cómo calcula ese precio.',
    'No prometas compras, contratos, exclusividad ni aprobación de precios.',
    'No lo conviertas en proveedor oficial. La formalización requiere autorización expresa del Owner.'
  ].filter(Boolean).join(' ');
}

module.exports = {
  CANDIDATE_OUTREACH_CAPABILITY,
  DEFAULT_MAX_AGE_MS,
  buildProviderCandidateInstructions,
  candidateAuditFromJob,
  candidateMatches,
  findLatestProviderCandidate,
  normalizePhone,
  resolveProviderCandidateRelationship
};
