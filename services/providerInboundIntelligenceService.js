'use strict';

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_WAHA_BASE_URL = 'https://waha.elankav.com';
const MAX_PROVIDER_FILE_BYTES = 25 * 1024 * 1024;

function normalizeBaseUrl(value, fallback) {
  return String(value || fallback).trim().replace(/\/+$/, '');
}

function normalizePhone(value) {
  const digits = String(value || '').split('@')[0].replace(/\D/g, '');
  if (!digits) return '';
  return digits.length === 8 ? `505${digits}` : digits;
}

function providerToken() {
  return String(
    process.env.CONNECT_PROVIDER_INTELLIGENCE_TOKEN ||
    process.env.CONNECT_VOICE_TOKEN ||
    ''
  ).trim();
}

function connectBaseUrl() {
  return normalizeBaseUrl(process.env.ELANKAV_CONNECT_URL, DEFAULT_CONNECT_URL);
}

function wahaConfig() {
  const baseUrl = normalizeBaseUrl(process.env.WAHA_BASE_URL, DEFAULT_WAHA_BASE_URL);
  const internalBaseUrl = normalizeBaseUrl(
    process.env.WAHA_INTERNAL_BASE_URL || process.env.WAHA_BASE_URL,
    DEFAULT_WAHA_BASE_URL
  );
  return {
    baseUrl,
    internalBaseUrl,
    apiKey: String(process.env.WAHA_API_KEY || process.env.WAHA_API_TOKEN || '').trim()
  };
}

function isSameHost(url, baseUrl) {
  try { return new URL(url).host === new URL(baseUrl).host; } catch { return false; }
}

function providerHeaders(extra = {}) {
  const token = providerToken();
  if (!token) {
    const error = new Error('CONNECT_PROVIDER_INTELLIGENCE_TOKEN_REQUIRED');
    error.code = 'CONNECT_PROVIDER_INTELLIGENCE_TOKEN_REQUIRED';
    error.status = 503;
    throw error;
  }
  return {
    Accept: 'application/json',
    'X-Connect-Provider-Token': token,
    ...extra
  };
}

async function readJsonResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload?.error?.message || `CONNECT HTTP ${response.status}`);
    error.code = payload?.error?.code || 'CONNECT_PROVIDER_INTELLIGENCE_FAILED';
    error.status = response.status;
    throw error;
  }
  return payload;
}

function providerMatchesPhone(item, normalized) {
  if (!item || item.status !== 'active' || !normalized) return false;
  return [item.whatsapp, item.phone]
    .map(normalizePhone)
    .some(value => value && value === normalized);
}

async function fetchProviderRows(url, fetchImpl) {
  const response = await fetchImpl(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) return [];
  const rows = await response.json().catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

async function resolveRegisteredProvider({ phone, fetchImpl = fetch }) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const baseUrl = connectBaseUrl();
  const searched = await fetchProviderRows(
    `${baseUrl}/api/v1/providers?search=${encodeURIComponent(normalized)}&status=active`,
    fetchImpl
  );
  const direct = searched.find(item => providerMatchesPhone(item, normalized));
  if (direct) return direct;

  // The provider search endpoint historically indexed whatsapp_normalized but not
  // every legacy phone value. Fall back to the active provider directory and
  // compare both official contact fields locally so a provider contacted through
  // `phone` is still recognized when replying inbound.
  const active = await fetchProviderRows(`${baseUrl}/api/v1/providers?status=active`, fetchImpl);
  return active.find(item => providerMatchesPhone(item, normalized)) || null;
}

async function ingestProviderText({ providerId, text, externalMessageId, receivedAt, fetchImpl = fetch }) {
  const normalizedText = String(text || '').trim();
  if (!normalizedText) return null;
  const response = await fetchImpl(`${connectBaseUrl()}/api/v1/providers/${encodeURIComponent(providerId)}/intelligence/messages`, {
    method: 'POST',
    headers: providerHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      text: normalizedText,
      sourceChannel: 'whatsapp',
      ...(externalMessageId ? { externalMessageId } : {}),
      ...(receivedAt ? { receivedAt } : {})
    }),
    signal: AbortSignal.timeout(120_000)
  });
  return readJsonResponse(response);
}

function resolveMediaUrl(mediaUrl, baseUrl) {
  return new URL(String(mediaUrl || ''), `${baseUrl}/`).toString();
}

async function downloadMediaOnce({ url, authorizedBaseUrls, apiKey, fetchImpl }) {
  const headers = { Accept: '*/*' };
  if (apiKey && authorizedBaseUrls.some(base => isSameHost(url, base))) headers['X-Api-Key'] = apiKey;
  const response = await fetchImpl(url, {
    method: 'GET',
    headers,
    signal: AbortSignal.timeout(45_000)
  });
  if (!response.ok) {
    const error = new Error(`WAHA media HTTP ${response.status}`);
    error.code = 'WAHA_PROVIDER_MEDIA_DOWNLOAD_FAILED';
    error.status = response.status;
    throw error;
  }
  const announced = Number(response.headers.get('content-length') || 0);
  if (announced > MAX_PROVIDER_FILE_BYTES) {
    const error = new Error('Provider file too large');
    error.code = 'WAHA_PROVIDER_MEDIA_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (!buffer.length || buffer.length > MAX_PROVIDER_FILE_BYTES) {
    const error = new Error(buffer.length ? 'Provider file too large' : 'Provider file empty');
    error.code = buffer.length ? 'WAHA_PROVIDER_MEDIA_TOO_LARGE' : 'WAHA_PROVIDER_MEDIA_EMPTY';
    error.status = buffer.length ? 413 : 422;
    throw error;
  }
  return {
    buffer,
    mimeType: String(response.headers.get('content-type') || 'application/octet-stream').split(';')[0].trim()
  };
}

async function downloadProviderMedia({ url, fetchImpl = fetch }) {
  if (!url) {
    const error = new Error('WAHA_PROVIDER_MEDIA_URL_REQUIRED');
    error.code = 'WAHA_PROVIDER_MEDIA_URL_REQUIRED';
    error.status = 400;
    throw error;
  }
  const config = wahaConfig();
  const primary = resolveMediaUrl(url, config.baseUrl);
  try {
    return await downloadMediaOnce({
      url: primary,
      authorizedBaseUrls: [config.baseUrl, config.internalBaseUrl],
      apiKey: config.apiKey,
      fetchImpl
    });
  } catch (error) {
    if (![401, 403].includes(error.status) && !(error.status >= 500)) throw error;
    if (!config.internalBaseUrl || config.internalBaseUrl === config.baseUrl) throw error;
    const parsed = new URL(primary);
    const fallback = resolveMediaUrl(`${parsed.pathname}${parsed.search}`, config.internalBaseUrl);
    return downloadMediaOnce({
      url: fallback,
      authorizedBaseUrls: [config.baseUrl, config.internalBaseUrl],
      apiKey: config.apiKey,
      fetchImpl
    });
  }
}

async function ingestProviderDocument({ providerId, mediaUrl, mimeType, fileName, externalMessageId, fetchImpl = fetch }) {
  const media = await downloadProviderMedia({ url: mediaUrl, fetchImpl });
  const finalMime = String(media.mimeType || mimeType || 'application/octet-stream').split(';')[0].trim();
  const response = await fetchImpl(`${connectBaseUrl()}/api/v1/providers/${encodeURIComponent(providerId)}/intelligence/documents`, {
    method: 'POST',
    headers: providerHeaders({
      'Content-Type': finalMime || 'application/octet-stream',
      'X-File-Name': encodeURIComponent(fileName || 'provider-attachment'),
      'X-Source-Channel': 'whatsapp',
      ...(externalMessageId ? { 'X-External-Message-Id': encodeURIComponent(externalMessageId) } : {})
    }),
    body: media.buffer,
    signal: AbortSignal.timeout(150_000)
  });
  return readJsonResponse(response);
}

module.exports = {
  MAX_PROVIDER_FILE_BYTES,
  downloadProviderMedia,
  ingestProviderDocument,
  ingestProviderText,
  normalizePhone,
  providerMatchesPhone,
  resolveRegisteredProvider
};