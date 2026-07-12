const http = require('node:http');
const https = require('node:https');

const DEFAULT_TIMEOUT_MS = 3000;
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost']);

function resolveVscodeHealthUrl() {
  const rawUrl = String(
    process.env.VSCODE_WEB_HEALTH_URL || 'http://127.0.0.1:3001/healthz'
  ).trim();

  const parsed = new URL(rawUrl);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('VSCODE_WEB_PROTOCOL_NOT_ALLOWED');
  }

  if (!ALLOWED_HOSTS.has(parsed.hostname)) {
    throw new Error('VSCODE_WEB_HOST_NOT_ALLOWED');
  }

  return parsed;
}

function requestHealth(url, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const client = url.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.get(url, {
      headers: {
        Accept: 'application/json,text/plain;q=0.9,*/*;q=0.1'
      }
    }, response => {
      response.resume();
      response.on('end', () => {
        resolve({
          reachable: true,
          healthy: response.statusCode >= 200 && response.statusCode < 400,
          statusCode: response.statusCode
        });
      });
    });

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error('VSCODE_WEB_TIMEOUT'));
    });

    request.on('error', reject);
  });
}

async function getVscodeRuntimeStatus() {
  const healthUrl = resolveVscodeHealthUrl();

  try {
    const result = await requestHealth(healthUrl);

    return {
      configured: true,
      endpoint: healthUrl.origin,
      ...result,
      checkedAt: new Date().toISOString()
    };
  } catch (error) {
    return {
      configured: true,
      endpoint: healthUrl.origin,
      reachable: false,
      healthy: false,
      statusCode: null,
      error: error.message,
      checkedAt: new Date().toISOString()
    };
  }
}

module.exports = {
  getVscodeRuntimeStatus,
  resolveVscodeHealthUrl
};
