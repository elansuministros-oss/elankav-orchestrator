'use strict';

const DEFAULT_COMMERCIAL_LIBRARY_URL =
  'https://elankav-core.vercel.app/api/commercial-library';
const DEFAULT_TIMEOUT_MS = 5000;
const MAX_MESSAGE_LENGTH = 1000;

function resolveCommercialLibraryUrl() {
  const configured = String(
    process.env.COMMERCIAL_LIBRARY_URL || ''
  ).trim();

  return configured || DEFAULT_COMMERCIAL_LIBRARY_URL;
}

async function fetchCommercialOffer(
  message,
  {
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS
  } = {}
) {
  const normalizedMessage = String(message || '')
    .trim()
    .slice(-MAX_MESSAGE_LENGTH);

  if (!normalizedMessage) return null;

  if (typeof fetchImpl !== 'function') {
    const error = new Error('Cliente HTTP comercial no disponible');
    error.code = 'COMMERCIAL_LIBRARY_CLIENT_UNAVAILABLE';
    throw error;
  }

  const endpoint = new URL(resolveCommercialLibraryUrl());
  endpoint.searchParams.set('message', normalizedMessage);

  let response;

  try {
    response = await fetchImpl(endpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (cause) {
    const error = new Error('Biblioteca comercial no disponible');
    error.code = 'COMMERCIAL_LIBRARY_UNAVAILABLE';
    error.cause = cause;
    throw error;
  }

  if (response.status === 404) return null;

  const payload = await response.json().catch(() => null);

  if (!response.ok || payload?.success !== true || !payload.result) {
    const error = new Error('Respuesta comercial inválida');
    error.code = 'COMMERCIAL_LIBRARY_RESPONSE_INVALID';
    throw error;
  }

  return payload.result;
}

module.exports = {
  DEFAULT_COMMERCIAL_LIBRARY_URL,
  DEFAULT_TIMEOUT_MS,
  MAX_MESSAGE_LENGTH,
  fetchCommercialOffer,
  resolveCommercialLibraryUrl
};
