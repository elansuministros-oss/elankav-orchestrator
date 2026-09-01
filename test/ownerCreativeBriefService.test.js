const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCreativeBrief,
  detectCreativeKind,
  isCreativeBriefRequest
} = require('../services/ownerCreativeBriefService');

test('detecta lenguaje natural para crear plantilla HTML', () => {
  const text = 'ELAN creemos una plantilla para mensaje de prospectos de fachadas, por WhatsApp, premium';
  assert.equal(isCreativeBriefRequest(text), true);
  assert.equal(detectCreativeKind(text), 'html');

  const brief = buildCreativeBrief(text);
  assert.match(brief, /PROMPT TÉCNICO PARA CHATGPT/);
  assert.match(brief, /1080 × 540 px/);
  assert.match(brief, /2:1/);
  assert.match(brief, /fachadas y rotulación/);
  assert.match(brief, /premium/);
  assert.match(brief, /\{\{company_name\}\}/);
  assert.match(brief, /Entregar solamente el archivo HTML final/);
});

test('detecta lenguaje natural para video y define formato móvil', () => {
  const text = 'ELAN hagamos un video para reel de fachadas de 20 segundos para prospectos';
  assert.equal(isCreativeBriefRequest(text), true);
  assert.equal(detectCreativeKind(text), 'video');

  const brief = buildCreativeBrief(text);
  assert.match(brief, /BRIEF DE PRODUCCIÓN DE VIDEO/);
  assert.match(brief, /1080 × 1920 px/);
  assert.match(brief, /9:16/);
  assert.match(brief, /20 segundos/);
  assert.match(brief, /voz ELAN/);
  assert.match(brief, /revisión Owner/);
});

test('no secuestra conversación normal del Owner', () => {
  assert.equal(isCreativeBriefRequest('cuántos prospectos tenemos hoy'), false);
  assert.equal(isCreativeBriefRequest('manda el correo a compras'), false);
  assert.equal(isCreativeBriefRequest('estado del sistema'), false);
});
