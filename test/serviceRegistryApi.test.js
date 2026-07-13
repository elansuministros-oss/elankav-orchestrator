const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleServiceRegistryApi
} = require('../api/serviceRegistryApi');

function createResponseCapture() {
  const capture = {
    headers: {},
    statusCode: null,
    payload: null
  };

  return {
    capture,
    res: {
      setHeader(name, value) {
        capture.headers[name] = value;
      }
    },
    sendJson(_res, statusCode, payload) {
      capture.statusCode = statusCode;
      capture.payload = payload;
    }
  };
}

function createRequest({ url, actor, token, method = 'GET' }) {
  return {
    url,
    method,
    headers: {
      host: 'localhost',
      ...(actor ? { 'x-elankav-actor': actor } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  };
}

test('Service Registry bloquea acceso sin identidad Owner', () => {
  const previousToken = process.env.VSCODE_ACCESS_TOKEN;
  process.env.VSCODE_ACCESS_TOKEN = 'registry-test-token';

  try {
    const { capture, res, sendJson } = createResponseCapture();
    const handled = handleServiceRegistryApi({
      req: createRequest({ url: '/api/services' }),
      res,
      sendJson
    });

    assert.equal(handled, true);
    assert.equal(capture.statusCode, 403);
    assert.equal(capture.payload.code, 'SERVICE_REGISTRY_ACCESS_DENIED');
  } finally {
    if (previousToken === undefined) {
      delete process.env.VSCODE_ACCESS_TOKEN;
    } else {
      process.env.VSCODE_ACCESS_TOKEN = previousToken;
    }
  }
});

test('Owner consulta snapshot del Service Registry', () => {
  const previousToken = process.env.VSCODE_ACCESS_TOKEN;
  process.env.VSCODE_ACCESS_TOKEN = 'registry-test-token';

  try {
    const { capture, res, sendJson } = createResponseCapture();
    const handled = handleServiceRegistryApi({
      req: createRequest({
        url: '/api/services',
        actor: '50588388940',
        token: 'registry-test-token'
      }),
      res,
      sendJson
    });

    assert.equal(handled, true);
    assert.equal(capture.statusCode, 200);
    assert.equal(capture.payload.success, true);
    assert.equal(capture.payload.registry.count, 11);
    assert.equal(capture.payload.registry.mode, 'read-only');
  } finally {
    if (previousToken === undefined) {
      delete process.env.VSCODE_ACCESS_TOKEN;
    } else {
      process.env.VSCODE_ACCESS_TOKEN = previousToken;
    }
  }
});

test('Owner consulta un servicio específico y recibe 404 para desconocido', () => {
  const previousToken = process.env.VSCODE_ACCESS_TOKEN;
  process.env.VSCODE_ACCESS_TOKEN = 'registry-test-token';

  try {
    const known = createResponseCapture();
    handleServiceRegistryApi({
      req: createRequest({
        url: '/api/services/documentation',
        actor: '50588388940',
        token: 'registry-test-token'
      }),
      res: known.res,
      sendJson: known.sendJson
    });

    assert.equal(known.capture.statusCode, 200);
    assert.equal(known.capture.payload.service.id, 'documentation');
    assert.equal(known.capture.payload.service.capabilities.write, false);

    const unknown = createResponseCapture();
    handleServiceRegistryApi({
      req: createRequest({
        url: '/api/services/unknown',
        actor: '50588388940',
        token: 'registry-test-token'
      }),
      res: unknown.res,
      sendJson: unknown.sendJson
    });

    assert.equal(unknown.capture.statusCode, 404);
    assert.equal(unknown.capture.payload.code, 'SERVICE_NOT_FOUND');
  } finally {
    if (previousToken === undefined) {
      delete process.env.VSCODE_ACCESS_TOKEN;
    } else {
      process.env.VSCODE_ACCESS_TOKEN = previousToken;
    }
  }
});