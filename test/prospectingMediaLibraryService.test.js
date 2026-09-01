'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyFolder,
  classifyTags,
  isLibraryMediaSaveRequest,
  titleFromInstruction
} = require('../services/prospectingMediaLibraryService');

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
