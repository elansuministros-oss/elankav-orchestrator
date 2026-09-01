'use strict';

const { listJobs } = require('./jobs/jobQueue');

const PROVIDER_OUTBOUND_CAPABILITIES = new Set([
  'business.provider.message.send',
  'business.provider.quote-request.send'
]);
const DEFAULT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function normalizePhone(value) {
  const digits = clean(value).split('@')[0].replace(/\D/g, '');
  return digits.length === 8 ? `505${digits}` : digits;
}

function extractProviderName(message) {
  const match = clean(message).match(/^\s*\[PROVEEDOR REGISTRADO:\s*([^\]]+)\]/i);
  return clean(match?.[1]);
}

function auditFromJob(job) {
  const audit = job?.result?.audit;
  if (!audit || typeof audit !== 'object') return null;
  const capability = clean(audit.capability || job?.task);
  if (!PROVIDER_OUTBOUND_CAPABILITIES.has(capability)) return null;
  if (audit.success === false || clean(job?.status).toLowerCase() === 'failed') return null;
  return {
    capability,
    metadata: audit.metadata && typeof audit.metadata === 'object' ? audit.metadata : {},
    createdAt: clean(audit.createdAt || job?.createdAt)
  };
}

function auditMatchesProvider(audit, { providerName, phone }) {
  const metadata = audit?.metadata || {};
  const wantedName = normalize(providerName);
  const auditName = normalize(metadata.provider || metadata.providerName);
  const wantedPhone = normalizePhone(phone);
  const auditPhone = normalizePhone(metadata.phone || metadata.whatsapp || metadata.chatId);

  if (wantedPhone && auditPhone && wantedPhone === auditPhone) return true;
  if (wantedName && auditName && (wantedName === auditName || auditName.includes(wantedName) || wantedName.includes(auditName))) return true;
  return false;
}

function findLatestProviderAudit(jobs, { providerName, phone, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  return (Array.isArray(jobs) ? jobs : [])
    .map(auditFromJob)
    .filter(Boolean)
    .filter(audit => auditMatchesProvider(audit, { providerName, phone }))
    .filter(audit => {
      const timestamp = Date.parse(audit.createdAt);
      return Number.isFinite(timestamp) && timestamp <= now && now - timestamp <= maxAgeMs;
    })
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] || null;
}

function buildProviderHistoryText(audit) {
  if (!audit) return '';
  const metadata = audit.metadata || {};
  const provider = clean(metadata.provider || metadata.providerName) || 'el proveedor';
  const subject = clean(metadata.item || metadata.subject) || 'la solicitud pendiente';
  const requestKind = clean(metadata.requestKind).toLowerCase();
  const isQuote = audit.capability === 'business.provider.quote-request.send' || requestKind === 'quote';

  return isQuote
    ? `ELAN envió por orden del Owner una solicitud a ${provider} para obtener precio/cotización de ${subject}. La conversación está pendiente de respuesta del proveedor; continuá ese mismo asunto y no lo trates como cliente o prospecto.`
    : `ELAN envió por orden del Owner una consulta a ${provider} sobre ${subject}. La conversación está pendiente de respuesta del proveedor; continuá ese mismo seguimiento y no lo trates como cliente o prospecto.`;
}

async function loadProviderContinuityHistory({ message, phone, now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}, { listJobsImpl = listJobs } = {}) {
  const providerName = extractProviderName(message);
  if (!providerName && !normalizePhone(phone)) return [];
  const jobs = await listJobsImpl();
  const audit = findLatestProviderAudit(jobs, { providerName, phone, now, maxAgeMs });
  const text = buildProviderHistoryText(audit);
  return text ? [{ role: 'assistant', content: text, createdAt: audit.createdAt }] : [];
}

module.exports = {
  DEFAULT_MAX_AGE_MS,
  PROVIDER_OUTBOUND_CAPABILITIES,
  auditFromJob,
  auditMatchesProvider,
  buildProviderHistoryText,
  extractProviderName,
  findLatestProviderAudit,
  loadProviderContinuityHistory,
  normalizePhone
};