'use strict';

const http = require('node:http');
const { handleWorkspaceIntelligenceApi } = require('./api/workspaceIntelligenceApi');

const originalCreateServer = http.createServer.bind(http);

http.createServer = function createServerWithWorkspaceTools(listener) {
  if (typeof listener !== 'function') return originalCreateServer(listener);

  return originalCreateServer(async (req, res) => {
    const sendJson = (response, statusCode, data) => {
      response.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store'
      });
      response.end(JSON.stringify(data, null, 2));
    };

    try {
      const handled = await handleWorkspaceIntelligenceApi({ req, res, sendJson });
      if (handled) return;
    } catch (error) {
      sendJson(res, 500, {
        success: false,
        error: {
          code: 'WORKSPACE_API_UNAVAILABLE',
          message: 'No fue posible procesar la herramienta de workspace'
        }
      });
      return;
    }

    return listener(req, res);
  });
};

require('./server');
