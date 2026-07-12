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

test('Owner Mode reconoce los dos números configurados', () => {
  withOwnerEnv('+505 8838 8940, +505 7882 8089', () => {
    assert.deepEqual(getOwnerPhones(), [
      '50588388940',
      '50578828089'
    ]);

    for (const externalUserId of [
      '50588388940@c.us',
      '50578828089@c.us'
    ]) {
      const context = buildContext({
        message: 'estado del ecosistema',
        platform: 'elanvisual',
        channel: 'whatsapp',
        externalUserId
      });

      assert.equal(context.owner.isOwner, true);
    }
  });
});

test('Owner Mode mantiene compatibilidad con variable singular', () => {
  const previousPlural = process.env.ORCHESTRATOR_OWNER_PHONES;
  const previousSingular = process.env.ORCHESTRATOR_OWNER_PHONE;

  delete process.env.ORCHESTRATOR_OWNER_PHONES;
  process.env.ORCHESTRATOR_OWNER_PHONE = '50578828089';

  try {
    assert.deepEqual(getOwnerPhones(), ['50578828089']);
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

test('Owner Mode no reconoce un número distinto', () => {
  withOwnerEnv('50588388940,50578828089', () => {
    const context = buildContext({
      message: 'estado del ecosistema',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50588888888@c.us'
    });

    assert.equal(context.owner.isOwner, false);
  });
});
