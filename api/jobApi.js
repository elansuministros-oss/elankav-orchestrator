const {
  createJobRequest,
  getJobRequest,
  listJobsRequest
} = require('../services/jobService');

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

function sendMethodNotAllowed({
  res,
  sendJson,
  allowed
}) {
  res.setHeader('Allow', allowed.join(', '));

  sendJson(res, 405, {
    success: false,
    error: 'Método no permitido',
    allowed
  });
}

function isPersistenceError(error) {
  return String(error?.code || error?.message || '')
    .startsWith('JOB_SUPABASE_') ||
    error?.message === 'JOB_PERSISTENCE_WRITE_FAILED';
}

function sendPersistenceUnavailable(res, sendJson) {
  sendJson(res, 503, {
    success: false,
    error: 'Persistencia de Jobs no disponible'
  });
}

async function handleJobApi({
  req,
  res,
  sendJson
}) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = requestUrl.pathname;

  if (pathname === '/api/jobs') {
    if (req.method === 'GET') {
      try {
        const jobs = await listJobsRequest();

        sendJson(res, 200, {
          success: true,
          count: jobs.length,
          jobs
        });
      } catch (error) {
        if (isPersistenceError(error)) {
          sendPersistenceUnavailable(res, sendJson);
        } else {
          throw error;
        }
      }

      return true;
    }

    if (req.method !== 'POST') {
      sendMethodNotAllowed({
        res,
        sendJson,
        allowed: ['GET', 'POST']
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
      const result = await createJobRequest(payload);

      sendJson(res, 201, result);
    } catch (error) {
      if (isPersistenceError(error)) {
        sendPersistenceUnavailable(res, sendJson);
        return true;
      }

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

  const jobMatch = pathname.match(
    /^\/api\/jobs\/([^/]+)$/
  );

  if (!jobMatch) {
    return false;
  }

  if (req.method !== 'GET') {
    sendMethodNotAllowed({
      res,
      sendJson,
      allowed: ['GET']
    });

    return true;
  }

  const jobId = decodeURIComponent(jobMatch[1]);
  let job;

  try {
    job = await getJobRequest(jobId);
  } catch (error) {
    if (isPersistenceError(error)) {
      sendPersistenceUnavailable(res, sendJson);
      return true;
    }

    throw error;
  }

  if (!job) {
    sendJson(res, 404, {
      success: false,
      error: 'Job no encontrado',
      jobId
    });

    return true;
  }

  sendJson(res, 200, {
    success: true,
    job
  });

  return true;
}

module.exports = {
  handleJobApi,
  isPersistenceError
};
