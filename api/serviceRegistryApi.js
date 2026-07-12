const {
  getServiceRegistrySnapshot,
  getAuthorizedService
} = require('../services/serviceRegistryService');
const {
  isOwnerRequest
} = require('./vscodeApi');

function handleServiceRegistryApi({ req, res, sendJson }) {
  const requestUrl = new URL(
    req.url,
    `http://${req.headers.host || 'localhost'}`
  );

  const pathname = requestUrl.pathname;

  if (pathname !== '/api/services' && !pathname.startsWith('/api/services/')) {
    return false;
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

  if (!isOwnerRequest(req)) {
    sendJson(res, 403, {
      success: false,
      error: 'Acceso denegado',
      code: 'SERVICE_REGISTRY_ACCESS_DENIED'
    });
    return true;
  }

  if (pathname === '/api/services') {
    sendJson(res, 200, {
      success: true,
      registry: getServiceRegistrySnapshot()
    });
    return true;
  }

  const serviceId = decodeURIComponent(pathname.slice('/api/services/'.length));
  const service = getAuthorizedService(serviceId);

  if (!service) {
    sendJson(res, 404, {
      success: false,
      error: 'Servicio no encontrado',
      code: 'SERVICE_NOT_FOUND'
    });
    return true;
  }

  sendJson(res, 200, {
    success: true,
    service
  });

  return true;
}

module.exports = {
  handleServiceRegistryApi
};
