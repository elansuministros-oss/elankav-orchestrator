const test = require('node:test');
const assert = require('node:assert/strict');

const {
  assertSupportedAudioMimeType,
  downloadWahaMedia,
  isAuthorizedWahaHost,
  normalizeMimeType,
  resolveMediaUrl,
  transcribeAudio
} = require('../services/connectVoiceService');

function withEnv(values, callback) {
  const previous = {};
  for (const key of Object.keys(values)) {
    previous[key] = process.env[key];
    if (values[key] === undefined) delete process.env[key];
    else process.env[key] = values[key];
  }

  return Promise.resolve()
    .then(callback)
    .finally(() => {
      for (const key of Object.keys(values)) {
        if (previous[key] === undefined) delete process.env[key];
        else process.env[key] = previous[key];
      }
    });
}

test('normaliza audio/ogg; codecs=opus y lo acepta', () => {
  assert.equal(normalizeMimeType('audio/ogg; codecs=opus'), 'audio/ogg');
  assert.equal(assertSupportedAudioMimeType('audio/ogg; codecs=opus'), 'audio/ogg');
});

test('resuelve URL relativa de media con WAHA_BASE_URL', async () => {
  await withEnv({ WAHA_BASE_URL: 'https://waha.test' }, () => {
    assert.equal(resolveMediaUrl('/api/files/voice.ogg'), 'https://waha.test/api/files/voice.ogg');
  });
});

test('conserva URL absoluta de media', async () => {
  await withEnv({ WAHA_BASE_URL: 'https://waha.test' }, () => {
    assert.equal(resolveMediaUrl('https://waha.test/api/files/voice.ogg'), 'https://waha.test/api/files/voice.ogg');
  });
});

test('X-Api-Key solo se autoriza para hosts WAHA configurados', async () => {
  assert.equal(isAuthorizedWahaHost('https://waha.test/api/files/1.ogg', ['https://waha.test']), true);
  assert.equal(isAuthorizedWahaHost('https://cdn.example/api/files/1.ogg', ['https://waha.test']), false);
});

test('descarga media y adjunta X-Api-Key al host autorizado', async () => {
  await withEnv({
    WAHA_BASE_URL: 'https://waha.test',
    WAHA_INTERNAL_BASE_URL: 'https://waha-internal.test',
    WAHA_API_KEY: 'not-printed'
  }, async () => {
    const calls = [];
    const media = await downloadWahaMedia({
      url: '/api/files/voice.ogg',
      async fetchImpl(url, options) {
        calls.push({ url: String(url), headers: options.headers });
        return new Response(Buffer.from('audio'), {
          status: 200,
          headers: { 'content-type': 'audio/ogg' }
        });
      }
    });

    assert.equal(calls[0].url, 'https://waha.test/api/files/voice.ogg');
    assert.equal(calls[0].headers['X-Api-Key'], 'not-printed');
    assert.equal(media.buffer.toString(), 'audio');
  });
});

test('descarga media usa fallback interno ante HTTP 502', async () => {
  await withEnv({
    WAHA_BASE_URL: 'https://waha-public.test',
    WAHA_INTERNAL_BASE_URL: 'http://waha-internal.test',
    WAHA_API_KEY: 'not-printed'
  }, async () => {
    const hosts = [];
    const media = await downloadWahaMedia({
      url: '/api/files/voice.ogg',
      async fetchImpl(url) {
        hosts.push(new URL(url).host);
        if (hosts.length === 1) return new Response('bad gateway', { status: 502 });
        return new Response(Buffer.from('audio'), {
          status: 200,
          headers: { 'content-type': 'audio/ogg' }
        });
      }
    });

    assert.deepEqual(hosts, ['waha-public.test', 'waha-internal.test']);
    assert.equal(media.buffer.toString(), 'audio');
  });
});

test('descarga media no reintenta ante HTTP 404', async () => {
  await withEnv({
    WAHA_BASE_URL: 'https://waha-public.test',
    WAHA_INTERNAL_BASE_URL: 'http://waha-internal.test'
  }, async () => {
    let calls = 0;
    await assert.rejects(
      downloadWahaMedia({
        url: '/api/files/missing.ogg',
        async fetchImpl() {
          calls += 1;
          return new Response('missing', { status: 404 });
        }
      }),
      /WAHA media HTTP 404/
    );
    assert.equal(calls, 1);
  });
});

test('descarga media rechaza archivo vacío y excesivo', async () => {
  await withEnv({ WAHA_BASE_URL: 'https://waha.test' }, async () => {
    await assert.rejects(
      downloadWahaMedia({
        url: '/api/files/empty.ogg',
        async fetchImpl() {
          return new Response(Buffer.alloc(0), { status: 200 });
        }
      }),
      { code: 'WAHA_MEDIA_EMPTY' }
    );

    await assert.rejects(
      downloadWahaMedia({
        url: '/api/files/large.ogg',
        async fetchImpl() {
          return new Response(Buffer.from('audio'), {
            status: 200,
            headers: { 'content-length': String(26 * 1024 * 1024) }
          });
        }
      }),
      { code: 'WAHA_MEDIA_TOO_LARGE' }
    );
  });
});

test('CONNECT transcripción recibe multipart/form-data', async () => {
  await withEnv({
    ELANKAV_CONNECT_URL: 'https://connect.test',
    CONNECT_VOICE_TOKEN: 'not-printed'
  }, async () => {
    let isFormData = false;
    let hasManualContentType = false;

    const text = await transcribeAudio({
      audio: Buffer.from('audio'),
      mimeType: 'audio/ogg; codecs=opus',
      async fetchImpl(_url, options) {
        isFormData = options.body instanceof FormData;
        hasManualContentType = Object.keys(options.headers).some(
          key => key.toLowerCase() === 'content-type'
        );
        return new Response(JSON.stringify({ text: 'hola' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });

    assert.equal(isFormData, true);
    assert.equal(hasManualContentType, false);
    assert.equal(text, 'hola');
  });
});

test('CONNECT devuelve JSON en errores 404 sin token expuesto', async () => {
  await withEnv({
    ELANKAV_CONNECT_URL: 'https://connect.test',
    CONNECT_VOICE_TOKEN: 'not-printed',
    OPENAI_API_KEY: undefined
  }, async () => {
    await assert.rejects(
      transcribeAudio({
        audio: Buffer.from('audio'),
        mimeType: 'audio/ogg',
        async fetchImpl() {
          return new Response(JSON.stringify({
            error: { code: 'ROUTE_NOT_FOUND', message: 'route missing' }
          }), {
            status: 404,
            headers: { 'content-type': 'application/json' }
          });
        }
      }),
      { code: 'VOICE_CONFIGURATION_INVALID' }
    );
  });
});
