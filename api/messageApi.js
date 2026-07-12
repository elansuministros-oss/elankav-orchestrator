const {
  processMessage
} = require('../services/messageService');
const {
  handleVscodeApi
} = require('./vscodeApi');
const {
  handleServiceRegistryApi
} = require('./serviceRegistryApi');

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

async function handleMessageApi({
  req,
  res,
  sendJson
}) {
  const vscodeHandled = await handleVscodeApi({
    req,
    res,
    sendJson
  });

  if (vscodeHandled) {
    return true;
  }

  const serviceRegistryHandled = handleServiceRegistryApi({
    req,
    res,
    sendJson
  });

  if (serviceRegistryHandled) {
    return true;
  }

  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  if (requestUrl.pathname !== '/api/messages') {
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

    const result = await processMessage({
      message: payload.message,
      instructions: payload.instructions,
      platform: payload.platform,
      channel: payload.channel,
      externalUserId: payload.externalUserId,
      phone: payload.phone,
      metadata: payload.metadata
    });

    sendJson(res, 200, {
      success: true,
      result
    });
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

    if (error.code === 'MESSAGE_REQUIRED') {
      sendJson(res, 400, {
        success: false,
        error: error.message
      });
      return true;
    }

    if (error.code === 'OPENAI_NOT_CONFIGURED') {
      sendJson(res, 503, {
        success: false,
        error: error.message,
        code: error.code
      });
      return true;
    }

    sendJson(res, 502, {
      success: false,
      error: 'No fue posible generar la respuesta',
      detail: error.message,
      code: error.code || null,
      status: error.status || null
    });
  }

  return true;
}

module.exports = {
  handleMessageApi
};