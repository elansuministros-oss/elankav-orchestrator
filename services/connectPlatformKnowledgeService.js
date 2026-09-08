'use strict';

const fs = require('node:fs');

const DEFAULT_CONNECT_URL = 'https://connect.elankav.com';
const DEFAULT_TIMEOUT_MS = 8000;

const GENERIC_COMMERCIAL_QUERY_TOKENS = new Set([
  'precio', 'precios', 'cuanto', 'cuesta', 'costar', 'costo', 'costos', 'cotizar', 'cotizacion',
  'presupuesto', 'valor', 'vale', 'necesito', 'quiero', 'dame', 'metro', 'metros', 'para', 'por',
  'del', 'una', 'uno', 'unos', 'unas', 'con', 'sin', 'impresion', 'imprimir', 'impreso', 'impresa'
]);

function normalizeSearch(value) {
  return normalizeText(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function commercialQueryTokens(query) {
  return normalizeSearch(query)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !GENERIC_COMMERCIAL_QUERY_TOKENS.has(token));
}

function knowledgeSearchWords(item = {}) {
  const data = item?.data && typeof item.data === 'object' ? item.data : {};
  const aliases = Array.isArray(data.aliases) ? data.aliases : [];
  const tags = Array.isArray(item.tags) ? item.tags : [];
  return normalizeSearch([
    item.title,
    ...tags,
    ...aliases,
    data.name,
    data.sku,
    data.productId
  ].filter(Boolean).join(' ')).split(/[^a-z0-9]+/).filter(Boolean);
}

function filterCommercialKnowledgePayload(payload, query) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.knowledge)) return payload;
  const tokens = commercialQueryTokens(query);
  if (!normalizeText(query)) return payload;
  const knowledge = tokens.length
    ? payload.knowledge.filter((item) => {
        const words = new Set(knowledgeSearchWords(item));
        return tokens.some((token) => words.has(token));
      })
    : [];
  return { ...payload, knowledge };
}

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizePlatform(value) {
  const normalized = normalizeText(value).toLowerCase();
  const aliases = {
    visual: 'elanvisual',
    elanvisual: 'elanvisual',
    home: 'elanhome',
    elanhome: 'elanhome',
    pet: 'elanpet',
    elanpet: 'elanpet',
    connect: 'connect',
    elankav: 'elankav'
  };
  return aliases[normalized] || 'elanvisual';
}

function resolveConnectUrl() {
  return normalizeText(
    process.env.ELANKAV_CONNECT_URL ||
    process.env.CONNECT_API_URL ||
    DEFAULT_CONNECT_URL
  ).replace(/\/+$/, '');
}

function resolveElanOneCommercialUrl() {
  return normalizeText(
    process.env.ELAN_ONE_COMMERCIAL_BASE_URL ||
    process.env.ELAN_ONE_ACTOR_IDENTITY_BASE_URL ||
    process.env.ELAN_ONE_UNIFIED_MEMORY_BASE_URL
  ).replace(/\/+$/, '');
}

function readTokenFromEnvFile(filePath) {
  const path = normalizeText(filePath);
  if (!path) return '';
  try {
    const line = fs.readFileSync(path, 'utf8').split(/\r?\n/).find((entry) => entry.startsWith('VQS_API_TOKEN='));
    return line ? normalizeText(line.slice('VQS_API_TOKEN='.length).replace(/^['"]|['"]$/g, '')) : '';
  } catch {
    return '';
  }
}

function elanOneCommercialHeaders() {
  const token = normalizeText(
    process.env.ELAN_ONE_VQS_API_TOKEN ||
    readTokenFromEnvFile(process.env.ELAN_ONE_VQS_ENV_FILE) ||
    process.env.VQS_API_TOKEN ||
    process.env.DESIGN_API_TOKEN
  );
  if (!token) return null;
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  };
}

function commercialItemToKnowledge(item = {}, index = 0) {
  const name = normalizeText(item.name || item.code || item.id || `Producto ${index + 1}`);
  const price = item.pricePerM2 ?? item.pricePerLinearMeter ?? item.unitPrice ?? item.basePrice ?? item.minimumPrice ?? null;
  const unit = item.formulaType === 'AREA_M2' ? 'm²' : item.formulaType === 'METRO_LINEAL' ? 'metro lineal' : item.formulaType === 'UNIDAD' ? 'unidad' : '';
  const priceText = price !== null && price !== undefined ? ` Tarifa autorizada: ${normalizeText(item.currency || 'USD')} ${Number(price).toFixed(2)}${unit ? ` por ${unit}` : ''}.` : '';
  return {
    id: `elan-one-commercial-${normalizeText(item.id || item.code || index)}`,
    platform_id: 'elanvisual',
    item_type: 'PRODUCT',
    title: name,
    content: `${normalizeText(item.description || name)}.${priceText}`.trim(),
    data: {
      ...item,
      authority: 'ELAN_ONE_COMMERCIAL_PRODUCTS',
      approved: true,
      ...(price !== null && price !== undefined ? { price } : {})
    },
    tags: [name, normalizeText(item.category), normalizeText(item.subcategory), normalizeText(item.code)].filter(Boolean),
    status: 'ACTIVE'
  };
}

async function fetchElanOneCommercialKnowledge(query, fetchFn = globalThis.fetch) {
  const baseUrl = resolveElanOneCommercialUrl();
  const headers = elanOneCommercialHeaders();
  if (!baseUrl || !headers || typeof fetchFn !== 'function' || !normalizeText(query)) return null;
  const response = await fetchFn(`${baseUrl}/api/v1/business/vqs/pricing/resolve`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query: normalizeText(query) }),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.data) {
    const error = new Error(`ELAN_ONE_COMMERCIAL_HTTP_${response.status}`);
    error.code = payload?.code || payload?.error?.code || 'ELAN_ONE_COMMERCIAL_REQUEST_FAILED';
    error.status = response.status;
    throw error;
  }
  const data = payload.data;
  if (data.status === 'NOT_FOUND') return { status: 'NOT_FOUND', knowledge: [] };
  const items = data.status === 'MULTIPLE'
    ? (Array.isArray(data.matches) ? data.matches : [])
    : data.item ? [data.item] : [];
  return {
    status: normalizeText(data.status || 'FOUND'),
    clarificationType: data.clarificationType || null,
    question: data.question || null,
    knowledge: items.map(commercialItemToKnowledge)
  };
}

function buildHeaders() {
  const token = normalizeText(
    process.env.CONNECT_INTERNAL_API_TOKEN ||
    process.env.CONNECT_INTERNAL_TOKEN ||
    process.env.ORCHESTRATOR_INTERNAL_TOKEN ||
    process.env.ELANKAV_CONNECT_INTERNAL_TOKEN ||
    process.env.CRM_INTERNAL_TOKEN
  );

  if (!token) {
    const error = new Error('CONNECT_INTERNAL_API_TOKEN_REQUIRED');
    error.code = 'CONNECT_INTERNAL_API_TOKEN_REQUIRED';
    error.status = 503;
    throw error;
  }

  return {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    'X-Elankav-Internal-Token': token,
    'X-Elankav-Platform': 'ORCHESTRATOR',
    'X-Elankav-Actor-Type': 'system'
  };
}

async function fetchPlatformKnowledge({ platform, query, fetchFn = globalThis.fetch } = {}) {
  if (typeof fetchFn !== 'function') {
    const error = new Error('FETCH_NOT_AVAILABLE');
    error.code = 'FETCH_NOT_AVAILABLE';
    throw error;
  }

  const platformId = normalizePlatform(platform);
  const params = new URLSearchParams();
  const normalizedQuery = normalizeText(query);
  if (normalizedQuery) params.set('q', normalizedQuery);

  const suffix = params.toString() ? `?${params.toString()}` : '';
  const response = await fetchFn(
    `${resolveConnectUrl()}/console/api/ai-platforms/${encodeURIComponent(platformId)}/context${suffix}`,
    {
      method: 'GET',
      headers: buildHeaders(),
      signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
    }
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(
      payload?.error?.message ||
      payload?.error ||
      `CONNECT_PLATFORM_KNOWLEDGE_HTTP_${response.status}`
    );
    error.code = payload?.error?.code || 'CONNECT_PLATFORM_KNOWLEDGE_REQUEST_FAILED';
    error.status = response.status;
    error.details = payload;
    throw error;
  }

  let filteredPayload = filterCommercialKnowledgePayload(payload, normalizedQuery);
  if (platformId === 'elanvisual' && normalizedQuery && Array.isArray(filteredPayload?.knowledge) && filteredPayload.knowledge.length === 0) {
    try {
      const fallback = await fetchElanOneCommercialKnowledge(normalizedQuery, fetchFn);
      if (fallback?.knowledge?.length) {
        filteredPayload = {
          ...filteredPayload,
          knowledge: fallback.knowledge,
          commercialResolution: {
            source: 'ELAN_ONE_COMMERCIAL_PRODUCTS',
            status: fallback.status,
            clarificationType: fallback.clarificationType,
            question: fallback.question
          }
        };
      }
    } catch (error) {
      console.error('[ELAN_ONE_COMMERCIAL_KNOWLEDGE_FALLBACK_FAILED]', {
        code: error?.code || null,
        status: error?.status || null,
        message: error?.message || String(error)
      });
    }
  }

  return {
    source: 'ELANKAV_CONNECT',
    policy: 'approved-commercial-catalogs-only',
    platformId,
    query: normalizedQuery || null,
    available: Boolean(payload),
    payload: filteredPayload
  };
}

async function loadPlatformKnowledgeSafely(input = {}) {
  try {
    return await fetchPlatformKnowledge(input);
  } catch (error) {
    console.error('[CONNECT_PLATFORM_KNOWLEDGE_UNAVAILABLE]', {
      code: error?.code || null,
      status: error?.status || null,
      message: error?.message || String(error)
    });
    return {
      source: 'ELANKAV_CONNECT',
      policy: 'approved-commercial-catalogs-only',
      platformId: normalizePlatform(input.platform),
      query: normalizeText(input.query) || null,
      available: false,
      error: error?.code || error?.message || 'CONNECT_PLATFORM_KNOWLEDGE_UNAVAILABLE',
      payload: null
    };
  }
}

module.exports = {
  DEFAULT_CONNECT_URL,
  normalizePlatform,
  resolveConnectUrl,
  resolveElanOneCommercialUrl,
  commercialItemToKnowledge,
  readTokenFromEnvFile,
  fetchElanOneCommercialKnowledge,
  commercialQueryTokens,
  filterCommercialKnowledgePayload,
  fetchPlatformKnowledge,
  loadPlatformKnowledgeSafely
};