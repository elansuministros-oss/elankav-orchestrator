'use strict';

const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DEFAULT_TIMEOUT_MS = 15000;

function resolveDesignEngineUrl() {
  const value = String(process.env.DESIGN_ENGINE_URL || '').trim();
  return value ? value.replace(/\/+$/, '') : null;
}

async function handleDesignAssetApi({
  req,
  res,
  sendJson,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers?.host || 'localhost'}`
  );
  const match = requestUrl.pathname.match(
    /^\/api\/design-assets\/([^/]+)$/
  );

  if (!match) {
    return false;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendJson(res, 405, {
      success: false,
      error: 'Método no permitido',
      allowed: ['GET', 'HEAD'],
    });
    return true;
  }

  const assetId = match[1];
  if (!ASSET_ID_PATTERN.test(assetId)) {
    sendJson(res, 404, {
      success: false,
      error: 'ASSET_NOT_FOUND',
    });
    return true;
  }

  const endpoint = resolveDesignEngineUrl();
  if (!endpoint || typeof fetchImpl !== 'function') {
    sendJson(res, 503, {
      success: false,
      error: 'DESIGN_ENGINE_UNAVAILABLE',
    });
    return true;
  }

  let upstream;
  try {
    upstream = await fetchImpl(
      `${endpoint}/internal/assets/${assetId}`,
      {
        method: req.method,
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
  } catch (cause) {
    const timedOut =
      cause?.name === 'TimeoutError' ||
      cause?.name === 'AbortError';

    sendJson(res, 504, {
      success: false,
      error: timedOut
        ? 'DESIGN_ASSET_TIMEOUT'
        : 'DESIGN_ENGINE_UNAVAILABLE',
    });
    return true;
  }

  if (upstream.status === 404) {
    sendJson(res, 404, {
      success: false,
      error: 'ASSET_NOT_FOUND',
    });
    return true;
  }

  if (!upstream.ok) {
    sendJson(res, 502, {
      success: false,
      error: 'DESIGN_ASSET_UPSTREAM_ERROR',
      status: upstream.status,
    });
    return true;
  }

  const contentType = String(
    upstream.headers?.get?.('content-type') || ''
  ).toLowerCase();

  if (!contentType.includes('image/png')) {
    sendJson(res, 502, {
      success: false,
      error: 'DESIGN_ASSET_INVALID_CONTENT_TYPE',
    });
    return true;
  }

  const contentLength = upstream.headers?.get?.('content-length');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  const buffer = Buffer.from(await upstream.arrayBuffer());
  if (buffer.length === 0) {
    sendJson(res, 502, {
      success: false,
      error: 'DESIGN_ASSET_EMPTY',
    });
    return true;
  }

  res.end(buffer);
  return true;
}

module.exports = {
  ASSET_ID_PATTERN,
  DEFAULT_TIMEOUT_MS,
  handleDesignAssetApi,
};
