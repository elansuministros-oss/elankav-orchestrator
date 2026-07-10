const { createJobRequest } = require('../services/jobService');

const MAX_BODY_BYTES = 64 * 1024;

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let receivedBytes = 0;
    let settled = false;

    req.on('data', chunk => {
      if (settled) {
        return;
      }

      receivedBytes += chunk.length;

      if (receivedBytes > MAX_BODY_BYTES) {
        settled = true;
        reject(new Error('PAYLOAD_TOO_LARGE'));
        req.destroy();
        return;
      }

      body += chunk.toString('utf8');
    });

    req.on('end', () => {
      if (settled) {
        return;
      }

      settled = true;

      if (!body.trim()) {
        reject(new Error('BODY_REQUIRED'));
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', error => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
  });
}

async function handleJobApi({ req, res, sendJson }) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (requestUrl.pathname !== '/api/jobs') {
    return false;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');

    sendJson(res, 405, {
      success: false,
      error: 'Método no permitido',
      allowed: ['POST']
    });

    return true;
  }

  const contentType = String(
    req.headers['content-type'] || ''
  ).toLowerCase();

  if (!contentType.includes('application/json')) {
    sendJson(res, 415, {
      success: false,
      error: 'Content-Type debe ser application/json'
    });

    return true;
  }

  try {
    const payload = await readJsonBody(req);
    const result = createJobRequest(payload);

    sendJson(res, 201, result);
  } catch (error) {
    if (error.message === 'PAYLOAD_TOO_LARGE') {
      sendJson(res, 413, {
        success: false,
        error: 'Solicitud demasiado grande'
      });

      return true;
    }

    if (error.message === 'BODY_REQUIRED') {
      sendJson(res, 400, {
        success: false,
        error: 'El cuerpo JSON es obligatorio'
      });

      return true;
    }

    if (error.message === 'INVALID_JSON') {
      sendJson(res, 400, {
        success: false,
        error: 'JSON inválido'
      });

      return true;
    }

    sendJson(res, 400, {
      success: false,
      error: error.message
    });
  }

  return true;
}

module.exports = {
  handleJobApi
};
