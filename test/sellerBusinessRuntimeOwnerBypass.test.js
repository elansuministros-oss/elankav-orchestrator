'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  installSellerBusinessRuntimeIntegration
} = require('../services/sellerBusinessRuntimeIntegration');

function baseResult(message) {
  return {
    message,
    reply: 'OWNER_GATEWAY_RESULT',
    provider: 'elankav',
    model: 'test',
    status: 'completed'
  };
}

test('Owner phone bypasses seller authority completely', async () => {
  let actorCalls = 0;
  let originalCalls = 0;

  const service = {
    async processMessage(args) {
      originalCalls += 1;
      return baseResult(args.message);
    }
  };

  installSellerBusinessRuntimeIntegration(service, {
    buildContextImpl() {
      return {
        owner: { isOwner: true },
        platform: 'elanvisual',
        channel: 'whatsapp'
      };
    },
    async resolveActorImpl() {
      actorCalls += 1;
      throw Object.assign(new Error('must not resolve Owner as seller'), {
        code: 'IDENTITY_AUTHORITY_UNAVAILABLE'
      });
    }
  });

  const result = await service.processMessage({
    message: 'Buscar 500 empresas',
    channel: 'whatsapp',
    phone: '50588388940'
  });

  assert.equal(actorCalls, 0);
  assert.equal(originalCalls, 1);
  assert.equal(result.reply, 'OWNER_GATEWAY_RESULT');
});

test('Owner LID alias bypasses seller authority using canonical context', async () => {
  let actorCalls = 0;
  let originalCalls = 0;

  const service = {
    async processMessage(args) {
      originalCalls += 1;
      return baseResult(args.message);
    }
  };

  installSellerBusinessRuntimeIntegration(service, {
    async resolveActorImpl() {
      actorCalls += 1;
      throw Object.assign(new Error('must not resolve Owner LID as seller'), {
        code: 'IDENTITY_AUTHORITY_UNAVAILABLE'
      });
    }
  });

  const result = await service.processMessage({
    message: 'Buscar 500 empresas',
    channel: 'whatsapp',
    externalUserId: '215440458567779@lid',
    metadata: {
      senderRaw: '215440458567779@lid',
      chatId: '215440458567779@lid'
    }
  });

  assert.equal(actorCalls, 0);
  assert.equal(originalCalls, 1);
  assert.equal(result.reply, 'OWNER_GATEWAY_RESULT');
});

test('non-owner WhatsApp still resolves through seller authority', async () => {
  let actorCalls = 0;
  let sellerCalls = 0;
  let originalCalls = 0;

  const service = {
    async processMessage(args) {
      originalCalls += 1;
      return baseResult(args.message);
    }
  };

  installSellerBusinessRuntimeIntegration(service, {
    buildContextImpl() {
      return {
        owner: { isOwner: false },
        platform: 'elanvisual',
        channel: 'whatsapp'
      };
    },
    async resolveActorImpl() {
      actorCalls += 1;
      return {
        role: 'seller',
        sellerId: 'seller-1',
        scopes: ['quotation.write']
      };
    },
    async handleSellerImpl() {
      sellerCalls += 1;
      return { handled: true, outputText: 'SELLER_RESULT' };
    }
  });

  const result = await service.processMessage({
    message: 'Creá una cotización',
    channel: 'whatsapp',
    phone: '50582121495'
  });

  assert.equal(actorCalls, 1);
  assert.equal(sellerCalls, 1);
  assert.equal(originalCalls, 0);
  assert.equal(result.reply, 'SELLER_RESULT');
});
