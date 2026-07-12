'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildContext,
  getOwnerPhone
} = require('../services/context/contextBuilder');

test('Owner Mode usa ORCHESTRATOR_OWNER_PHONE normalizado', () => {
  const previous = process.env.ORCHESTRATOR_OWNER_PHONE;
  process.env.ORCHESTRATOR_OWNER_PHONE = '+505 7882 8089';

  try {
    assert.equal(getOwnerPhone(), '50578828089');

    const context = buildContext({
      message: 'estado del ecosistema',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50578828089@c.us'
    });

    assert.equal(context.externalUserId, '50578828089');
    assert.equal(context.owner.isOwner, true);
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONE;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONE = previous;
    }
  }
});

test('Owner Mode no reconoce otro número', () => {
  const previous = process.env.ORCHESTRATOR_OWNER_PHONE;
  process.env.ORCHESTRATOR_OWNER_PHONE = '50578828089';

  try {
    const context = buildContext({
      message: 'estado del ecosistema',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50588888888@c.us'
    });

    assert.equal(context.owner.isOwner, false);
  } finally {
    if (previous === undefined) {
      delete process.env.ORCHESTRATOR_OWNER_PHONE;
    } else {
      process.env.ORCHESTRATOR_OWNER_PHONE = previous;
    }
  }
});
