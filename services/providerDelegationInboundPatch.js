'use strict';

const providerInbound = require('./providerInboundIntelligenceService');
const { listJobs } = require('./jobs/jobQueue');
const { handleDelegationInbound } = require('./businessDelegationService');
const { getOwnerResponseControl } = require('./ownerGlobalControlService');

let installed = false;

async function findOpenDelegationByProviderId(providerId) {
  const wanted = String(providerId || '').trim();
  if (!wanted) return null;
  const jobs = await listJobs();
  const open = new Set(['waiting_external', 'information_partial', 'decision_required']);
  return jobs.find(job =>
    job?.type === 'business_delegation'
    && open.has(job?.status)
    && String(job?.result?.delegation?.metadata?.providerId || '').trim() === wanted
  ) || null;
}

async function ownerOnlyEnabled() {
  try {
    return (await getOwnerResponseControl())?.enabled === true;
  } catch (error) {
    console.error('[OWNER_RESPONSE_CONTROL_READ_FAILED]', { code: error?.code || null, message: error?.message || String(error) });
    return false;
  }
}

async function trackProviderDelegation(providerId, text, occurredAt) {
  const job = await findOpenDelegationByProviderId(providerId);
  const delegation = job?.result?.delegation;
  if (!delegation?.phone || !String(text || '').trim()) return null;
  return handleDelegationInbound({ phone: delegation.phone, text, occurredAt: occurredAt || new Date().toISOString() });
}

function installProviderDelegationInboundPatch() {
  if (installed) return false;
  const previousText = providerInbound.ingestProviderText;
  const previousDocument = providerInbound.ingestProviderDocument;
  if (typeof previousText !== 'function' || typeof previousDocument !== 'function') {
    throw Object.assign(new Error('PROVIDER_INBOUND_INTELLIGENCE_REQUIRED'), { code: 'PROVIDER_INBOUND_INTELLIGENCE_REQUIRED' });
  }

  providerInbound.ingestProviderText = async function ingestProviderTextWithDelegation(args = {}) {
    const result = await previousText(args);
    try {
      await trackProviderDelegation(args.providerId, args.text, args.receivedAt);
    } catch (error) {
      console.error('[PROVIDER_DELEGATION_TRACK_FAILED]', { providerId: args.providerId || null, code: error?.code || null, message: error?.message || String(error) });
    }
    if (!(await ownerOnlyEnabled())) return result;
    return {
      ...(result && typeof result === 'object' ? result : {}),
      observationsSaved: 0,
      ownerOnlySuppressed: true
    };
  };

  providerInbound.ingestProviderDocument = async function ingestProviderDocumentWithDelegation(args = {}) {
    const result = await previousDocument(args);
    try {
      await trackProviderDelegation(
        args.providerId,
        `[Documento recibido del proveedor: ${String(args.fileName || 'adjunto').trim()}]`,
        new Date().toISOString()
      );
    } catch (error) {
      console.error('[PROVIDER_DELEGATION_DOCUMENT_TRACK_FAILED]', { providerId: args.providerId || null, code: error?.code || null, message: error?.message || String(error) });
    }
    if (!(await ownerOnlyEnabled())) return result;
    const error = new Error('OWNER_ONLY_PROVIDER_DOCUMENT_SUPPRESSED');
    error.code = 'OWNER_ONLY_PROVIDER_DOCUMENT_SUPPRESSED';
    error.status = 200;
    throw error;
  };

  installed = true;
  console.log('[PROVIDER_DELEGATION_INBOUND_PATCH_INSTALLED]', { delegationTracking: true, ownerOnlyFastPath: true });
  return true;
}

module.exports = {
  findOpenDelegationByProviderId,
  installProviderDelegationInboundPatch,
  ownerOnlyEnabled,
  trackProviderDelegation
};
