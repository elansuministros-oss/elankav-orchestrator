'use strict';

const fs = require('node:fs');
const test = require('node:test');
const assert = require('node:assert/strict');

const messageService = fs.readFileSync('services/messageService.js', 'utf8');
const runtimeService = fs.readFileSync('services/connectAiRuntimeService.js', 'utf8');
const openaiService = fs.readFileSync('services/openaiService.js', 'utf8');
const waha = fs.readFileSync('api/wahaWebhookApi.js', 'utf8');
const lock = fs.readFileSync('docs/CONNECT_AI_RUNTIME_AUTHORITY_LOCK.md', 'utf8');

test('candado: clientes usan exclusivamente el runtime de CONNECT', () => {
  assert.match(messageService, /loadConnectAiRuntimeSafely/);
  assert.match(messageService, /CONNECT_AI_RUNTIME_FAIL_CLOSED/);
  assert.match(messageService, /CONNECT_PLATFORM_RESPONSES_DISABLED/);
  assert.match(messageService, /AUTORIDAD DE COMPORTAMIENTO: CONNECT/);
  assert.doesNotMatch(messageService, /const CUSTOMER_INSTRUCTIONS/);
});

test('candado: instrucciones inyectadas no sustituyen CONNECT para clientes', () => {
  const nonOwnerBranch = messageService.slice(
    messageService.indexOf('function resolveMessageInstructions'),
    messageService.indexOf('function resolveRuntimeHistory')
  );
  assert.match(nonOwnerBranch, /return buildRuntimeInstructions\(runtime\)/);
  assert.doesNotMatch(nonOwnerBranch, /return normalizedCustom;/);
});

test('candado: el runtime valida autoridad y el OFF llega hasta WAHA', () => {
  assert.match(runtimeService, /CONNECT_AI_PLATFORMS/);
  assert.match(runtimeService, /authorityLocked !== true/);
  assert.match(runtimeService, /x-elankav-internal-token/);
  assert.match(waha, /r\?\.suppressed===true/);
  assert.match(waha, /replySent:false/);
});

test('candado: OpenAI no impone una conversación comercial paralela cuando CONNECT gobierna', () => {
  assert.match(openaiService, /CONNECT_AI_PLATFORMS/);
  assert.match(openaiService, /gobierna exclusivamente la configuración publicada de CONNECT/);
  assert.doesNotMatch(openaiService, /Respondé primero la pregunta del cliente y luego hacé como máximo/);
  assert.doesNotMatch(openaiService, /No vuelvas a preguntar medida, ambiente, iluminación/);
});

test('candado: diseño no conserva URL operativa hardcodeada en messageService', () => {
  assert.doesNotMatch(messageService, /const DESIGN_PORTAL_URL/);
  assert.match(messageService, /responseRules\?\.designRequest/);
  assert.match(lock, /No reactivar un enlace de diseño hardcodeado/);
});
