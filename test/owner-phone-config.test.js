'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildContext,
  getOwnerPhones
} = require('../services/context/contextBuilder');

function withOwnerEnv(value, callback) {
  const previousPlural = process.env.ORCHESTRATOR_OWNER_PHONES;
  const previousSingular = process.env.ORCHESTRATOR_OWNER_PHONE;

  process.env.ORCHESTRATOR_OWNER_PHONES = value;
  delete process.env.ORCHESTRATOR_OWNER_PHONE;

  try {
    callback();
  } finally {
    if (previousPlural === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONES;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONES = previousPlural;
    }

    if (previousSingular === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONE;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONE = previousSingular;
    }
  }
}

test('Owner Mode reconoce únicamente el número personal autorizado', () => {
  withOwnerEnv('+505 8838 8940', () => {
    assert.deepEqual(getOwnerPhones(), ['50588388940']);

    const context = buildContext({
      message: 'estado del ecosistema',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50588388940@c.us'
    });

    assert.equal(context.externalUserId, '50588388940');
    assert.equal(context.owner.isOwner, true);
  });
});

test('Número receptor de ELAN IA no activa Owner Mode', () => {
  withOwnerEnv('50588388940', () => {
    const context = buildContext({
      message: 'quiero una cotización',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50578828089@c.us'
    });

    assert.equal(context.externalUserId, '50578828089');
    assert.equal(context.owner.isOwner, false);
  });
});

test('Un cliente distinto tampoco activa Owner Mode', () => {
  withOwnerEnv('50588388940', () => {
    const context = buildContext({
      message: 'necesito información',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50588888888@c.us'
    });

    assert.equal(context.owner.isOwner, false);
  });
});

test('Owner Mode mantiene compatibilidad con variable singular', () => {
  const previousPlural = process.env.ORCHESTRATOR_OWNER_PHONES;
  const previousSingular = process.env.ORCHESTRATOR_OWNER_PHONE;

  delete process.env.ORCHESTRATOR_OWNER_PHONES;
  process.env.ORCHESTRATOR_OWNER_PHONE = '50588388940';

  try {
    assert.deepEqual(getOwnerPhones(), ['50588388940']);
  } finally {
    if (previousPlural === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONES;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONES = previousPlural;
    }

    if (previousSingular === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONE;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONE = previousSingular;
    }
  }
});