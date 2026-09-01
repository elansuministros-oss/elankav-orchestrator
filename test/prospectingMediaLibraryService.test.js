'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFolder,
  classifyTags,
  clearOwnerLibraryState,
  composeLibraryInstruction,
  consumePendingOwnerMedia,
  enableLibraryCapture,
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
