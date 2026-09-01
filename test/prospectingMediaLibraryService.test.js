'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalizeWahaMediaUrl,
  classifyFolder,
  classifyTags,
  clearOwnerLibraryState,
  composeLibraryInstruction,
  consumePendingOwnerMedia,
  enableLibraryCapture,
  hydrateOwnerWhatsappMedia,
  isLibraryCaptureActive,
  isLibraryCaptureStopRequest,
  isLibraryMediaSaveRequest,
  rememberPendingOwnerMedia,
  saveOwnerWhatsappMedia,
  titleFromInstruction
} = require('../services/prospectingMediaLibraryService');

test.afterEach(() => clearOwnerLibraryState());

test('detecta orden natural de guardar recurso multimedia', () => {
  assert.equal(
    isLibraryMediaSaveRequest('Carga esta imagen a la biblioteca, es una fachada en ACM con letras en PVC'),
    true
  );
  assert.equal(
    isLibraryMediaSaveRequest('Guarda este video en recursos. Caja de luz iluminada'),
    true
  );
  assert.equal(
    isLibraryMediaSaveRequest('Mandale esta foto al cliente'),
    false
  );
});


test('activa una sesión natural para recibir varias imágenes y conserva el contexto', () => {
  const owner = { session: 'ELANKAV', chatId: '50588388940@c.us' };
  assert.equal(
    isLibraryMediaSaveRequest('ELAN, te pasaré unas imágenes para cargar a la biblioteca'),
    true
  );
  assert.equal(
    isLibraryCaptureStopRequest('ELAN, te pasaré unas imágenes para cargar a la biblioteca'),
    false
  );

  enableLibraryCapture(owner, 'Te pasaré unas imágenes para cargar a la biblioteca');
  assert.equal(isLibraryCaptureActive(owner), true);

  const media = {
    ...owner,
    messageType: 'image',
    text: 'Fachada en ACM negro con letras PVC de 10 mm.',
    media: { url: '/api/files/fachada.jpg', mimeType: 'image/jpeg', filename: 'fachada.jpg' }
  };
  const instruction = composeLibraryInstruction(media);
  assert.match(instruction, /Guardar en biblioteca/i);
  assert.match(instruction, /Fachada en ACM negro/i);
  assert.equal(classifyFolder(instruction), 'rotulos_fachadas');
  assert.ok(classifyTags(instruction, 'image').includes('acm'));
});

test('recuerda el último archivo para aceptar después la orden cargar a la biblioteca', () => {
  const incoming = {
    session: 'ELANKAV',
    chatId: '50588388940@c.us',
    senderRaw: '50588388940@c.us',
    messageType: 'image',
    text: 'Fachada ACM con letras PVC',
    media: { url: '/api/files/fachada.jpg', mimeType: 'image/jpeg', filename: 'fachada.jpg' }
  };

  rememberPendingOwnerMedia(incoming);
  const pending = consumePendingOwnerMedia({
    session: 'ELANKAV',
    chatId: '50588388940@c.us'
  });

  assert.equal(pending.media.filename, 'fachada.jpg');
  assert.match(pending.text, /Fachada ACM/);
});

test('no confunde una solicitud de logs con una orden de cargar a Biblioteca', () => {
  assert.equal(
    isLibraryMediaSaveRequest('ELAN, muéstrame los últimos 100 logs de Orchestrator relacionados con el error que acaba de ocurrir al cargar imágenes a la Biblioteca. Solo lectura. No reinicies nada, no despliegues nada y no toques WAHA.'),
    false
  );
  assert.equal(
    isLibraryMediaSaveRequest('Revisa el error de cargar imágenes a la biblioteca y dime el estado del servicio'),
    false
  );
});

test('recupera URL de media desde WAHA cuando el webhook trae hasMedia pero no media.url', async () => {
  const incoming = {
    session: 'ELANKAV',
    chatId: '50588388940@c.us',
    senderRaw: '50588388940@c.us',
    messageId: 'false_50588388940@c.us_MEDIA123',
    messageType: 'image',
    text: 'Fachada ACM',
    media: { url: '', mimeType: 'image/jpeg', filename: 'attachment' }
  };

  const calls = [];
  const hydrated = await hydrateOwnerWhatsappMedia({
    incoming,
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), method: options?.method || 'GET' });
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            id: incoming.messageId,
            hasMedia: true,
            media: {
              url: 'http://localhost:3000/api/files/media123.jpg',
              mimetype: 'image/jpeg',
              filename: 'media123.jpg'
            }
          };
        }
      };
    }
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /downloadMedia=true/);
  assert.equal(hydrated.media.url, 'http://localhost:3000/api/files/media123.jpg');
  assert.equal(hydrated.media.mimeType, 'image/jpeg');
  assert.equal(hydrated.media.filename, 'media123.jpg');
});

test('clasifica fachada ACM + PVC en la carpeta funcional correcta', () => {
  const text = 'Carga esta imagen a la biblioteca. Es una fachada en ACM con letras en PVC, exterior.';
  assert.equal(classifyFolder(text), 'rotulos_fachadas');
  assert.deepEqual(
    classifyTags(text, 'image'),
    ['fachada', 'acm', 'pvc', 'letras', 'exterior', 'image']
  );
  assert.match(titleFromInstruction(text, 'rotulos_fachadas', 'image'), /fachada/i);
});

test('clasifica videos de caja de luz y conserva señal de video', () => {
  const text = 'Guarda este video en recursos: caja de luz iluminada con LED, trabajo terminado.';
  assert.equal(classifyFolder(text), 'cajas_luz');
  const tags = classifyTags(text, 'video');
  assert.ok(tags.includes('caja_luz'));
  assert.ok(tags.includes('led'));
  assert.ok(tags.includes('iluminado'));
  assert.ok(tags.includes('video'));
});


test('normaliza URL loopback de WAHA hacia un host autorizado sin abrir SSRF', () => {
  const rewritten = canonicalizeWahaMediaUrl(
    'http://localhost:3000/api/files/media123.jpg?token=abc',
    ['https://waha.elankav.com']
  );
  assert.equal(
    rewritten,
    'https://waha.elankav.com/api/files/media123.jpg?token=abc'
  );

  assert.throws(
    () => canonicalizeWahaMediaUrl(
      'http://169.254.169.254/latest/meta-data',
      ['https://waha.elankav.com']
    ),
    (error) => error && error.code === 'WAHA_MEDIA_HOST_NOT_ALLOWED'
  );

  assert.throws(
    () => canonicalizeWahaMediaUrl(
      'http://localhost:3000/admin',
      ['https://waha.elankav.com']
    ),
    (error) => error && error.code === 'WAHA_MEDIA_HOST_NOT_ALLOWED'
  );
});

test('rebasa host interno desconocido de WAHA hacia el origen autorizado sin usar su origen original', () => {
  const rewritten = canonicalizeWahaMediaUrl(
    'http://172.18.0.7:3000/api/files/abc123.jpg?token=xyz',
    ['https://waha.elankav.com']
  );

  assert.equal(
    rewritten,
    'https://waha.elankav.com/api/files/abc123.jpg?token=xyz'
  );
});

test('rechaza URLs multimedia fuera de los hosts WAHA autorizados', async () => {
  let fetched = false;
  await assert.rejects(
    saveOwnerWhatsappMedia({
      incoming: {
        messageType: 'image',
        text: 'Carga esta imagen a la biblioteca. Fachada ACM.',
        media: {
          url: 'http://169.254.169.254/latest/meta-data',
          mimeType: 'image/jpeg',
          filename: 'fachada.jpg'
        }
      },
      fetchImpl: async () => {
        fetched = true;
        throw new Error('No debe ejecutarse.');
      }
    }),
    (error) => error && error.code === 'WAHA_MEDIA_HOST_NOT_ALLOWED'
  );
  assert.equal(fetched, false);
});
