const test = require('node:test');
const assert = require('node:assert/strict');
const { applyVqsCors, isVqsRequest } = require('../api/messageApi');

function makeResponse() {
  const state = { headers: {}, statusCode: null, ended: false, body: '' };
  return {
    state,
    res: {
      setHeader(name, value) { state.headers[name] = value; },
      writeHead(statusCode, headers = {}) {
        state.statusCode = statusCode;
        Object.assign(state.headers, headers);
      },
      end(body = '') {
        state.ended = true;
        state.body = body;
      }
    }
  };
}

test('detecta únicamente rutas VQS', () => {
  assert.equal(isVqsRequest({ url: '/api/vqs/projects' }), true);
  assert.equal(isVqsRequest({ url: '/api/dashboard' }), false);
});

test('acepta preflight desde ELANVISUAL productivo', () => {
  const response = makeResponse();
  const result = applyVqsCors({
    method: 'OPTIONS',
    url: '/api/vqs/projects',
    headers: { origin: 'https://visual.elankav.com' }
  }, response.res);

  assert.equal(result.handled, true);
  assert.equal(result.allowed, true);
  assert.equal(response.state.statusCode, 204);
  assert.equal(response.state.headers['Access-Control-Allow-Origin'], 'https://visual.elankav.com');
});

test('acepta desarrollo local controlado', () => {
  const response = makeResponse();
  const result = applyVqsCors({
    method: 'POST',
    url: '/api/vqs/projects',
    headers: { origin: 'http://localhost:5173' }
  }, response.res);

  assert.equal(result.handled, false);
  assert.equal(result.allowed, true);
  assert.equal(response.state.headers['Access-Control-Allow-Origin'], 'http://localhost:5173');
});

test('rechaza origen no autorizado', () => {
  const response = makeResponse();
  const result = applyVqsCors({
    method: 'OPTIONS',
    url: '/api/vqs/projects',
    headers: { origin: 'https://example.com' }
  }, response.res);

  assert.equal(result.handled, true);
  assert.equal(result.allowed, false);
  assert.equal(response.state.statusCode, 403);
  assert.match(response.state.body, /CORS_ORIGIN_DENIED/);
});
