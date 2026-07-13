'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  handleDesignAssetApi
} = require('../api/designAssetApi');

const ASSET_ID = '66666666-6666-4666-8666-666666666666';

function createResponse() {
  const capture = {
    statusCode: null,
    headers: {},
    body: null,
    json: null
  };

  const res = {
    setHeader(name, value) {
      capture.headers[name.toLowerCase()] = value;
    },
    end(value) {
      capture.body = value;
    },
    set statusCode(value) {
      capture.statusCode = value;
    },
    get statusCode() {
      return capture.statusCode;
    }
  };

  function sendJson(target, statusCode, payload) {
    target.statusCode = statusCode;
    target.setHeader('Content-Type', 'application/json');
    capture.json = payload;
    target.end(Buffer.from(JSON.stringify(payload)));
  }

  return { capture, res, sendJson };
}

function createRequest(url, method = 'GET') {
  return {
    method,
    url,
    headers: { host: 'orchestrator.elankav.com' }
  };
}

function withDesignEngineUrl(callback) {
  const previous = process.env.DESIGN_ENGINE_URL;
  process.env.DESIGN_ENGINE_URL = 'http://127.0.0.1:4300';

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.DESIGN_ENGINE_URL;
      } else {
        process.env.DESIGN_ENGINE_URL = previous;
      }
    });
}

test('proxy entrega PNG sin exponer cabeceras internas', async () => {
  await withDesignEngineUrl(async () => {
    const { capture, res, sendJson } = createResponse();
    let requestedUrl;

    const handled = await handleDesignAssetApi({
      req: createRequest(`/api/design-assets/${ASSET_ID}`),
      res,
      sendJson,
      fetchImpl: async url => {
        requestedUrl = url;
        return {
          ok: true,
          status: 200,
          headers: {
            get(name) {
              if (name === 'content-type') return 'image/png';
              if (name === 'content-length') return '3';
              return null;
            }
          },
          async arrayBuffer() {
            return Uint8Array.from([1, 2, 3]).buffer;
          }
        };
      }
    });

    assert.equal(handled, true);
    assert.equal(
      requestedUrl,
      `http://127.0.0.1:4300/internal/assets/${ASSET_ID}`
    );
    assert.equal(capture.statusCode, 200);
    assert.equal(capture.headers['content-type'], 'image/png');
    assert.deepEqual(capture.body, Buffer.from([1, 2, 3]));
  });
});

test('proxy bloquea traversal', async () => {
  const { capture, res, sendJson } = createResponse();
  let fetchCalled = false;

  const handled = await handleDesignAssetApi({
    req: createRequest('/api/design-assets/..%2F..%2Fetc%2Fpasswd'),
    res,
    sendJson,
    fetchImpl: async () => {
      fetchCalled = true;
    }
  });

  assert.equal(handled, true);
  assert.equal(capture.statusCode, 404);
  assert.equal(capture.json.error, 'ASSET_NOT_FOUND');
  assert.equal(fetchCalled, false);
});

test('proxy devuelve 404 controlado', async () => {
  await withDesignEngineUrl(async () => {
    const { capture, res, sendJson } = createResponse();

    await handleDesignAssetApi({
      req: createRequest(`/api/design-assets/${ASSET_ID}`),
      res,
      sendJson,
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        headers: { get() { return null; } }
      })
    });

    assert.equal(capture.statusCode, 404);
    assert.equal(capture.json.error, 'ASSET_NOT_FOUND');
  });
});
