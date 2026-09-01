'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const tempFile = path.join(os.tmpdir(), `owner-quotation-mode-${process.pid}.json`);
process.env.OWNER_QUOTATION_MODE_STORE_PATH = tempFile;

const {
  clearState,
  getState,
  isQuotationModeStartRequest,
  nextQuestion,
  parsePrice,
  paymentTermsFromText,
  processQuotationModeText
} = require('../services/ownerQuotationModeService');

const identity = { externalUserId: '50588388940@c.us', phone: '50588388940', chatId: '50588388940@c.us' };

test.afterEach(async () => {
  await fs.rm(tempFile, { force: true });
});

test('detecta modo cotización en lenguaje natural', () => {
  assert.equal(isQuotationModeStartRequest('Activa modo cotización'), true);
  assert.equal(isQuotationModeStartRequest('modo cotizacion'), true);
  assert.equal(isQuotationModeStartRequest('quiero hacer una cotización'), true);
  assert.equal(isQuotationModeStartRequest('estado del sistema'), false);
});

test('parsea condiciones de pago y precio', () => {
  assert.deepEqual(paymentTermsFromText('60/40'), { depositPercent: 60, balancePercent: 40 });
  assert.deepEqual(paymentTermsFromText('anticipo 50%'), { depositPercent: 50, balancePercent: 50 });
  assert.deepEqual(parsePrice('USD 325'), { mode: 'explicit', amountUsd: 325 });
  assert.deepEqual(parsePrice('usar precio de biblioteca'), { mode: 'catalog', amountUsd: null });
});

test('modo cotización pregunta un dato por vez y persiste progreso', async () => {
  let out = await processQuotationModeText({ identity, text: 'Activa modo cotización' });
  assert.equal(out.handled, true);
  assert.match(out.outputText, /número de teléfono|WhatsApp/i);

  out = await processQuotationModeText({ identity, text: '78828089' });
  assert.match(out.outputText, /nombre del cliente/i);

  out = await processQuotationModeText({ identity, text: 'Empresa Demo' });
  assert.match(out.outputText, /Describime el trabajo/i);

  out = await processQuotationModeText({ identity, text: 'Fachada ACM 2 x 1 m con letras PVC' });
  assert.match(out.outputText, /condiciones de pago/i);

  out = await processQuotationModeText({ identity, text: '60/40' });
  assert.match(out.outputText, /dirección/i);

  out = await processQuotationModeText({ identity, text: 'Carretera a Masaya km 8' });
  assert.match(out.outputText, /precio final autorizado/i);

  out = await processQuotationModeText({ identity, text: 'USD 500' });
  assert.match(out.outputText, /imagen de referencia/i);

  const state = await getState(identity);
  assert.equal(state.step, 'image');
  assert.equal(state.data.phone, '78828089');
  assert.equal(state.data.customerName, 'Empresa Demo');
  assert.equal(state.data.explicitPriceUsd, 500);
});

test('sin imagen finaliza creando cliente y cotización oficial', async () => {
  const deps = {
    async resolveOrCreateCustomer(data) {
      return { customer: { id: 'cust-1', name: data.customerName, phone: data.phone, address: data.address }, created: true };
    },
    async updateContext() { return {}; },
    async prepareAndCreateQuotation(input) {
      assert.equal(input.productQuery, 'Fachada ACM 2 x 1 m con letras PVC');
      assert.equal(input.explicitPrice.amount, 500);
      assert.equal(input.paymentTerms.depositPercent, 60);
      return {
        ready: true,
        created: true,
        summary: '✅ Cotización oficial creada.\nCotización: Q-001',
        quotation: { quotationId: 'q-1', projectId: 'p-1' }
      };
    }
  };

  await processQuotationModeText({ identity, text: 'Activa modo cotización' });
  await processQuotationModeText({ identity, text: '78828089' });
  await processQuotationModeText({ identity, text: 'Empresa Demo' });
  await processQuotationModeText({ identity, text: 'Fachada ACM 2 x 1 m con letras PVC' });
  await processQuotationModeText({ identity, text: '60/40' });
  await processQuotationModeText({ identity, text: 'Managua' });
  await processQuotationModeText({ identity, text: 'USD 500' });
  const out = await processQuotationModeText({ identity, text: 'sin imagen', dependencies: deps });

  assert.equal(out.status, 'completed');
  assert.match(out.outputText, /Cotización oficial creada/);
  assert.equal(await getState(identity), null);
});

test('cancelar modo cotización no crea nada', async () => {
  await processQuotationModeText({ identity, text: 'Activa modo cotización' });
  const out = await processQuotationModeText({ identity, text: 'cancelar cotización' });
  assert.equal(out.status, 'cancelled');
  assert.match(out.outputText, /No creé ni envié ninguna cotización/);
  assert.equal(await getState(identity), null);
});
