'use strict';

const PUBLIC_PLATFORMS = Object.freeze(['elanvisual', 'elanhome', 'elanpet']);

function normalizePlatform(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function getConfiguration(env = process.env) {
  return {
    baseUrl: String(env.CONNECT_BASE_URL || env.CONNECT_URL || 'https://connect.elankav.com').replace(/\/+$/, ''),
    token: String(env.CONNECT_INTERNAL_API_TOKEN || '').trim(),
    timeoutMs: Number(env.CONNECT_AI_RUNTIME_TIMEOUT_MS || 8000)
  };
}

async function requestJson(url, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(url, options);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(payload?.error?.code || `CONNECT_AI_RUNTIME_HTTP_${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadPublishedRuntime(platform, options = {}) {
  const normalized = normalizePlatform(platform);
  if (!PUBLIC_PLATFORMS.includes(normalized)) {
    const error = new Error('AI_RUNTIME_PLATFORM_NOT_PUBLIC');
    error.platform = normalized;
    throw error;
  }
  const env = options.env || process.env;
  const config = getConfiguration(env);
  if (!config.token) throw new Error('CONNECT_INTERNAL_API_TOKEN_REQUIRED');
  return requestJson(
    `${config.baseUrl}/console/api/ai-platforms/runtime/${encodeURIComponent(normalized)}`,
    {
      method: 'GET',
      headers: { accept: 'application/json', 'x-elankav-internal-token': config.token },
      signal: AbortSignal.timeout(config.timeoutMs)
    },
    options.fetchImpl || fetch
  );
}

async function loadOfficialCatalogContext(platform, query, options = {}) {
  const normalized = normalizePlatform(platform);
  if (!PUBLIC_PLATFORMS.includes(normalized)) throw new Error('AI_RUNTIME_PLATFORM_NOT_PUBLIC');
  const config = getConfiguration(options.env || process.env);
  const url = `${config.baseUrl}/console/api/ai-platforms/${encodeURIComponent(normalized)}/context?q=${encodeURIComponent(String(query || ''))}`;
  return requestJson(url, { method: 'GET', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(config.timeoutMs) }, options.fetchImpl || fetch);
}

module.exports = {
  PUBLIC_PLATFORMS,
  normalizePlatform,
  getConfiguration,
  loadPublishedRuntime,
  loadOfficialCatalogContext
};
