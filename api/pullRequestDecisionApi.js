const {
  inspectJobPullRequest,
  decideJobPullRequest
} = require('../services/pullRequestDecisionService');

const MAX_BODY_BYTES = 16 * 1024;

function isAuthorized(req) {
  const configuredToken =
    process.env.ORCHESTRATOR_APPROVAL_TOKEN;

  if (!configuredToken) {
    return false;
  }

  const authorization = String(
    req.headers.authorization || ''
  );

  if (!authorization.startsWith('Bearer ')) {
    return false;
  }

  const suppliedToken =
    authorization.slice(7).trim();

  return suppliedToken === configuredToken;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    let bytes = 0;
    let settled = false;

    req.on('data', chunk => {
      if (settled) {
        return;
      }

      bytes += chunk.length;

      if (bytes > MAX_BODY_BYTES) {
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

async function handlePullRequestDecisionApi({
  req,
  res,
  sendJson
}) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const match = requestUrl.pathname.match(
    /^\/api\/pull-requests\/(\d+)(?:\/decision)?$/
  );

  if (!match) {
    return false;
  }

  if (!isAuthorized(req)) {
    sendJson(res, 401, {
      success: false,
      error: 'No autorizado'
    });

    return true;
  }

  const number = Number(match[1]);

  if (
    requestUrl.pathname.endsWith('/decision')
  ) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');

      sendJson(res, 405, {
        success: false,
        error: 'Método no permitido',
        allowed: ['POST']
      });

      return true;
    }

    try {
      const payload = await readJsonBody(req);

      const result =
        await decideJobPullRequest({
          platform: payload.platform,
          number,
          action: payload.action,
          confirmation: payload.confirmation,
          reason: payload.reason
        });

      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, {
        success: false,
        error: error.message
      });
    }

    return true;
  }

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');

    sendJson(res, 405, {
      success: false,
      error: 'Método no permitido',
      allowed: ['GET']
    });

    return true;
  }

  const platform =
    requestUrl.searchParams.get('platform');

  try {
    const result =
      await inspectJobPullRequest({
        platform,
        number
      });

    sendJson(res, 200, {
      success: true,
      repository:
        result.repository.fullName,
      platform:
        result.repository.id,
      checks: result.checks,
      pullRequest: {
        number: result.pullRequest.number,
        url: result.pullRequest.url,
        state: result.pullRequest.state,
        title: result.pullRequest.title,
        headBranch:
          result.pullRequest.headRefName,
        baseBranch:
          result.pullRequest.baseRefName,
        headSha:
          result.pullRequest.headRefOid,
        mergeable:
          result.pullRequest.mergeable,
        draft:
          result.pullRequest.isDraft,
        mergedAt:
          result.pullRequest.mergedAt
      }
    });
  } catch (error) {
    sendJson(res, 400, {
      success: false,
      error: error.message
    });
  }

  return true;
}

module.exports = {
  handlePullRequestDecisionApi
};
