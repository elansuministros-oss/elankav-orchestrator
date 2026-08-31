'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  followupMessage,
  localClock,
  withinContactWindow
} = require('../services/providerRecruitmentFollowupWorkerService');

test('seguimiento siempre identifica a ELAN como inteligencia artificial', () => {
  const text = followupMessage({
    provider: { tradeName: 'Proveedor Test' },
    recruitment: { followupAttempts: 0 },
    nextQuestion: '¿Tienen tarifario vigente?'
  });
  assert.match(text, /soy ELAN/i);
  assert.match(text, /inteligencia artificial/i);
  assert.match(text, /tarifario vigente/i);
});

test('segundo seguimiento se presenta como último intento automático', () => {
  const text = followupMessage({
    recruitment: { followupAttempts: 1 },
    nextQuestion: '¿Manejan crédito?'
  });
  assert.match(text, /último seguimiento/i);
});

test('ventana de contacto excluye domingo y horarios nocturnos', () => {
  const env = {
    PROVIDER_RECRUITMENT_TIMEZONE: 'America/Managua',
    PROVIDER_RECRUITMENT_CONTACT_START_HOUR: '8',
    PROVIDER_RECRUITMENT_CONTACT_END_HOUR: '18'
  };
  assert.equal(withinContactWindow(new Date('2026-08-31T15:00:00Z'), env), true);
  assert.equal(withinContactWindow(new Date('2026-08-31T02:00:00Z'), env), false);
  assert.equal(withinContactWindow(new Date('2026-08-30T15:00:00Z'), env), false);
  assert.equal(localClock(new Date('2026-08-31T15:00:00Z'), 'America/Managua').weekday, 'Mon');
});
