'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUOTATION_ITEM_ADD,
  createOwnerBusinessProcessMessage,
  detectOwnerBusinessCommand
} = require('../services/ownerBusinessProcessMessageGateway');

const COMMAND = 'ELAN buscá la cotización de la Dra. Abigail y después del centro de mesa agregá un rótulo estilo botón en acrílico de 60 x 60 cm. Buscá el precio autorizado y agregalo como nuevo ítem.';

function ownerContext() {
  return {
    version: 'TEST',
    platform: 'elanvisual',
    channel: 'whatsapp',
    externalUserId: '50588388940',
    owner: { isOwner: true, phone: '50588388940' }
  };
}

test('processMessage enruta alta multiítem Owner al gateway transaccional y no al fallback', async () => {
  let fallbackCalls = 0;
  let executeCalls = 0;
  let capturedCommand = null;

  const processMessage = createOwnerBusinessProcessMessage({
    originalProcessMessage: async () => {
      fallbackCalls += 1;
      return {
        provider: 'openai',
        model: 'should-not-run',
        reply: 'fallback generativo'
      };
    },
    buildContextImpl: ownerContext,
    detectCommandImpl: detectOwnerBusinessCommand,
    executeCommandImpl: async command => {
      executeCalls += 1;
      capturedCommand = command;
      return {
        handled: true,
        outputText: '✅ Ítem agregado a la misma cotización COT-2026-7B538F22.',
        result: {
          status: 'completed',
          quotationNumber: 'COT-2026-7B538F22',
          updatedExistingQuotation: true,
          duplicated: false
        }
      };
    }
  });

  const result = await processMessage({
    message: COMMAND,
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50588388940'
  });

  assert.equal(fallbackCalls, 0, 'el fallback generativo no debe ejecutarse');
  assert.equal(executeCalls, 1);
  assert.ok(capturedCommand);
  assert.equal(capturedCommand.type, QUOTATION_ITEM_ADD);
  assert.equal(capturedCommand.input.customerReference, 'Abigail');
  assert.equal(capturedCommand.input.anchorReference, 'centro de mesa');
  assert.equal(capturedCommand.input.width, 0.6);
  assert.equal(capturedCommand.input.height, 0.6);
  assert.match(capturedCommand.input.productQuery, /rotulo estilo boton en acrilico/i);

  assert.equal(result.provider, 'elankav');
  assert.equal(result.model, 'elankav-owner-business-command');
  assert.equal(result.command, QUOTATION_ITEM_ADD);
  assert.equal(result.status, 'completed');
  assert.equal(result.ownerBusinessCommand, true);
  assert.equal(result.context.ownerMode, true);
  assert.match(result.reply, /misma cotización/i);
});

test('processMessage no deja caer a OpenAI un comando empresarial detectado que falle', async () => {
  let fallbackCalls = 0;

  const processMessage = createOwnerBusinessProcessMessage({
    originalProcessMessage: async () => {
      fallbackCalls += 1;
      return { provider: 'openai', reply: 'incorrecto' };
    },
    buildContextImpl: ownerContext,
    detectCommandImpl: detectOwnerBusinessCommand,
    executeCommandImpl: async () => {
      const error = new Error('CONNECT no respondió');
      error.code = 'CONNECT_UNAVAILABLE';
      throw error;
    }
  });

  const result = await processMessage({
    message: COMMAND,
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50588388940'
  });

  assert.equal(fallbackCalls, 0);
  assert.equal(result.provider, 'elankav');
  assert.equal(result.status, 'failed');
  assert.equal(result.command, QUOTATION_ITEM_ADD);
  assert.match(result.reply, /CONNECT_UNAVAILABLE/);
  assert.match(result.reply, /No ejecuté una respuesta generativa/i);
});

test('processMessage conserva el flujo normal para no Owner', async () => {
  let fallbackCalls = 0;

  const processMessage = createOwnerBusinessProcessMessage({
    originalProcessMessage: async () => {
      fallbackCalls += 1;
      return { provider: 'openai', model: 'customer-flow', reply: 'flujo normal' };
    },
    buildContextImpl: () => ({
      version: 'TEST',
      platform: 'elanvisual',
      channel: 'whatsapp',
      externalUserId: '50577777777',
      owner: { isOwner: false, phone: null }
    })
  });

  const result = await processMessage({
    message: COMMAND,
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50577777777'
  });

  assert.equal(fallbackCalls, 1);
  assert.equal(result.model, 'customer-flow');
});
