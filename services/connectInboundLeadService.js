const DEFAULT_CONNECT_URL = 'https://elankav-connect.vercel.app';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 8) return `505${digits}`;
  return digits;
}

function resolveConnectUrl() {
  return normalizeText(process.env.ELANKAV_CONNECT_URL) || DEFAULT_CONNECT_URL;
}

async function request(path, options = {}, fetchFn = globalThis.fetch) {
  if (typeof fetchFn !== 'function') {
    const error = new Error('FETCH_NOT_AVAILABLE');
    error.code = 'FETCH_NOT_AVAILABLE';
    throw error;
  }

  const response = await fetchFn(`${resolveConnectUrl()}${path}`, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      'X-Elankav-Platform': 'ORCHESTRATOR',
      ...(options.headers || {})
    },
    signal: options.signal || AbortSignal.timeout(5000)
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || 'ELANKAV_CONNECT_REQUEST_FAILED');
    error.code = payload?.error?.code || 'ELANKAV_CONNECT_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function leadMatchesPhone(lead, normalizedPhone) {
  return [lead?.phone, lead?.whatsapp]
    .map(normalizePhone)
    .some(value => value && value === normalizedPhone);
}

async function findLeadByPhone({ phone, platform, fetchFn }) {
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return null;

  const params = new URLSearchParams({
    platform: normalizeText(platform) || 'ELANVISUAL',
    search: normalizedPhone
  });
  const rows = await request(`/api/v1/leads?${params.toString()}`, {}, fetchFn);
  return (Array.isArray(rows) ? rows : []).find(lead => leadMatchesPhone(lead, normalizedPhone)) || null;
}

async function ensureOpportunity({ lead, platform, message, fetchFn }) {
  const params = new URLSearchParams({ leadId: lead.id });
  const existing = await request(`/api/v1/opportunities?${params.toString()}`, {}, fetchFn);
  if (Array.isArray(existing) && existing.length > 0) return existing[0];

  return request('/api/v1/opportunities', {
    method: 'POST',
    body: JSON.stringify({
      leadId: lead.id,
      title: `Consulta WhatsApp ${lead.contactPerson || lead.name || lead.whatsapp || ''}`.trim(),
      platform: normalizeText(platform) || 'ELANVISUAL',
      stage: 'discovery',
      currency: 'USD',
      probability: 10,
      assignedExecutive: 'owner',
      notes: `Primer mensaje recibido por WhatsApp: ${normalizeText(message).slice(0, 1000)}`
    })
  }, fetchFn);
}

async function synchronizeInboundWhatsappLead({
  message,
  platform,
  channel,
  externalUserId,
  phone,
  ownerMode,
  metadata,
  fetchFn
} = {}) {
  if (ownerMode) return { skipped: true, reason: 'OWNER_MODE' };
  if (normalizeText(channel).toLowerCase() !== 'whatsapp') {
    return { skipped: true, reason: 'NOT_WHATSAPP' };
  }

  const normalizedPhone = normalizePhone(phone || externalUserId);
  if (!normalizedPhone) return { skipped: true, reason: 'PHONE_REQUIRED' };

  const resolvedPlatform = normalizeText(platform) || 'ELANVISUAL';
  let lead = await findLeadByPhone({ phone: normalizedPhone, platform: resolvedPlatform, fetchFn });

  if (!lead) {
    const contactName = normalizeText(metadata?.contactName || metadata?.pushName || metadata?.name);
    lead = await request('/api/v1/leads', {
      method: 'POST',
      body: JSON.stringify({
        name: contactName || `WhatsApp ${normalizedPhone}`,
        contactPerson: contactName || undefined,
        phone: normalizedPhone,
        whatsapp: normalizedPhone,
        source: 'whatsapp',
        platform: resolvedPlatform,
        status: 'new',
        priority: 'high',
        assignedExecutive: 'owner',
        tags: ['whatsapp', 'inbound'],
        notes: [
          externalUserId ? `External user: ${externalUserId}` : '',
          message ? `Mensaje inicial: ${normalizeText(message).slice(0, 1000)}` : ''
        ].filter(Boolean).join(' · ')
      })
    }, fetchFn);
  }

  const opportunity = await ensureOpportunity({
    lead,
    platform: resolvedPlatform,
    message,
    fetchFn
  });

  return { skipped: false, lead, opportunity };
}

async function synchronizeInboundWhatsappLeadSafely(input = {}) {
  try {
    return await synchronizeInboundWhatsappLead(input);
  } catch (error) {
    console.error('ELANKAV_CONNECT_WHATSAPP_SYNC_FAILED', {
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message || String(error)
    });
    return {
      skipped: true,
      reason: 'CONNECT_SYNC_FAILED',
      error: error?.code || error?.message || 'CONNECT_SYNC_FAILED'
    };
  }
}

module.exports = {
  DEFAULT_CONNECT_URL,
  normalizePhone,
  resolveConnectUrl,
  findLeadByPhone,
  synchronizeInboundWhatsappLead,
  synchronizeInboundWhatsappLeadSafely
};