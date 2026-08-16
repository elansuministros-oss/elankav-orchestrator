'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const COMMAND = 'ELAN buscá la cotización de la Dra. Abigail y después del centro de mesa agregá un rótulo estilo botón en acrílico de 60 x 60 cm. Buscá el precio autorizado y agregalo como nuevo ítem.';

// Stub de la frontera transaccional antes de instalar el gateway.
// El parser, ownerMode, preload y processMessage usados por la prueba son los reales.
const quotationMediaService = require('../services/ownerQuotationMediaService');
let transactionCalls = 0;
let transactionInput = null;
quotationMediaService.addItemByHumanReference = async input => {
  transactionCalls += 1;
  transactionInput = input;
  return {
    status: 'completed',
    outputText: '✅ Ítem agregado después de centro de mesa en COT-2026-7B538F22.',
    quotationNumber: 'COT-2026-7B538F22',
    updatedExistingQuotation: true,
    duplicated: false
  };
};

// Si el routing cae al modelo generativo, esta prueba debe fallar.
const openaiService = require('../services/openaiService');
let openaiCalls = 0;
openaiService.generateText = async () => {
  openaiCalls += 1;
  throw new Error('OPENAI_FALLBACK_MUST_NOT_RUN');
};

// Simula los dos arranques soportados: preload npm y bootstrap systemd.
require('../services/ownerBusinessQuotationItemPatch');
const { processMessage } = require('../services/messageService');

test('processMessage real ejecuta cotización multiítem por referencia humana sin OpenAI', async () => {
  const result = await processMessage({
    message: COMMAND,
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: '50588388940',
    phone: '50588388940',
    metadata: {
      messageId: 'TEST-OWNER-BUSINESS-001',
      chatId: '50588388940@c.us',
      messageType: 'text'
    }
  });

  assert.equal(openaiCalls, 0, 'OpenAI no debe ejecutarse para una transacción Owner reconocida');
  assert.equal(transactionCalls, 1, 'la transacción debe ejecutarse exactamente una vez');
  assert.ok(transactionInput);
  assert.equal(transactionInput.customerReference, 'Abigail');
  assert.equal(transactionInput.anchorReference, 'centro de mesa');
  assert.equal(transactionInput.width, 0.6);
  assert.equal(transactionInput.height, 0.6);
  assert.match(transactionInput.productQuery, /rotulo estilo boton en acrilico/i);

  assert.equal(result.provider, 'elankav');
  assert.equal(result.model, 'elankav-owner-business-command');
  assert.equal(result.status, 'completed');
  assert.equal(result.command, 'business_quotation_item_add');
  assert.equal(result.ownerBusinessCommand, true);
  assert.equal(result.actorRole, 'owner');
  assert.equal(result.context.ownerMode, true);
  assert.match(result.reply, /COT-2026-7B538F22/);
});
