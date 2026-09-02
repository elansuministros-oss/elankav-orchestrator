'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const tempFile = path.join(os.tmpdir(), `owner-quotation-mode-${process.pid}.json`);
process.env.OWNER_QUOTATION_MODE_STORE_PATH = tempFile;

const {
  getState,
  isQuotationModeStartRequest,
  parsePrice,
  paymentTermsFromText,
  processQuotationModeImage,
  processQuotationModeText,
  referenceVariants,
  resolvePartyReference,
  stripHonorifics
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

test('normaliza títulos profesionales para resolver el mismo cliente', () => {
  assert.equal(stripHonorifics('Doctora Abigail'), 'abigail');
  assert.equal(stripHonorifics('Dra. Abigail'), 'abigail');
  assert.deepEqual(referenceVariants('Doctora Abigail'), ['Doctora Abigail', 'abigail']);
});

test('“Doctora Abigail” encuentra cliente aunque esté registrado como “Dra. Abigail”', async () => {
  const queries = [];
  const deps = {
    async searchCustomers(query) {
      queries.push(query);
      if (query === 'abigail') {
        return {
          data: {
            results: [{
              customer: {
                id: 'cust-abigail',
                name: 'Dra. Abigail',
                companyName: 'Clínica Abigail',
                phone: '87770000',
                address: 'Managua'
              }
            }]
          }
        };
      }
      return { data: { results: [] } };
    },
    async searchProspects() {
      throw new Error('PROSPECT_SEARCH_SHOULD_NOT_RUN');
    }
  };

  const resolved = await resolvePartyReference('Doctora Abigail', deps);
  assert.equal(resolved.status, 'selected');
  assert.equal(resolved.sourceType, 'customer');
  assert.equal(resolved.sourceId, 'cust-abigail');
  assert.equal(resolved.customerName, 'Dra. Abigail');
  assert.deepEqual(queries, ['Doctora Abigail', 'abigail']);
});

test('cliente registrado se resuelve por nombre y reutiliza sus datos', async () => {
  const deps = {
    async searchCustomers(query) {
      assert.equal(query, 'Comex');
      return {
        data: {
          results: [{
            customer: {
              id: 'cust-comex',
              name: 'COMEX',
              companyName: 'COMEX Nicaragua',
              phone: '88887777',
              address: 'Managua'
            }
          }]
        }
      };
    },
    async searchProspects() {
      throw new Error('PROSPECT_SEARCH_SHOULD_NOT_RUN');
    }
  };

  const resolved = await resolvePartyReference('Comex', deps);
  assert.equal(resolved.status, 'selected');
  assert.equal(resolved.sourceType, 'customer');
  assert.equal(resolved.sourceId, 'cust-comex');
  assert.equal(resolved.phone, '88887777');
  assert.equal(resolved.address, 'Managua');
});

test('prospecto se reutiliza y si no hay nombre de persona usa el negocio como cliente', async () => {
  const deps = {
    async searchCustomers() { return { data: { results: [] } }; },
    async searchProspects(query) {
      assert.equal(query, 'Venga Baby');
      return [{
        id: 'prospect-1',
        companyName: 'Venga Baby',
        address: 'Masaya'
      }];
    },
    async getProspectTimeline(id) {
      assert.equal(id, 'prospect-1');
      return {
        contacts: [{
          channel: 'whatsapp',
          value: '50587776666',
          contactName: ''
        }]
      };
    }
  };

  const resolved = await resolvePartyReference('Venga Baby', deps);
  assert.equal(resolved.sourceType, 'prospect');
  assert.equal(resolved.customerName, 'Venga Baby');
  assert.equal(resolved.companyName, 'Venga Baby');
  assert.equal(resolved.phone, '87776666');
});

test('cliente nuevo por nombre usa nombre de tienda como cliente y negocio', async () => {
  const deps = {
    async searchCustomers() { return { data: { results: [] } }; },
    async searchProspects() { return []; }
  };

  const resolved = await resolvePartyReference('Repuestos El León de Judá', deps);
  assert.equal(resolved.status, 'new');
  assert.equal(resolved.customerName, 'Repuestos El León de Judá');
  assert.equal(resolved.companyName, 'Repuestos El León de Judá');
});

test('modo cotización acepta cliente nuevo y pregunta solo datos faltantes', async () => {
  const deps = {
    async searchCustomers() { return { data: { results: [] } }; },
    async searchProspects() { return []; }
  };

  let out = await processQuotationModeText({ identity, text: 'Activa modo cotización', dependencies: deps });
  assert.equal(out.handled, true);
  assert.match(out.outputText, /nombre del cliente\/negocio|teléfono|captura/i);

  out = await processQuotationModeText({ identity, text: 'Empresa Demo', dependencies: deps });
  assert.match(out.outputText, /número de teléfono|WhatsApp/i);

  out = await processQuotationModeText({ identity, text: '78828089', dependencies: deps });
  assert.match(out.outputText, /Describime el trabajo/i);

  out = await processQuotationModeText({ identity, text: 'Fachada ACM 2 x 1 m con letras PVC', dependencies: deps });
  assert.match(out.outputText, /condiciones de pago/i);

  out = await processQuotationModeText({ identity, text: '60/40', dependencies: deps });
  assert.match(out.outputText, /dirección/i);

  out = await processQuotationModeText({ identity, text: 'Carretera a Masaya km 8', dependencies: deps });
  assert.match(out.outputText, /precio final autorizado/i);

  out = await processQuotationModeText({ identity, text: 'USD 500', dependencies: deps });
  assert.match(out.outputText, /imagen de referencia/i);

  const state = await getState(identity);
  assert.equal(state.step, 'image');
  assert.equal(state.data.phone, '78828089');
  assert.equal(state.data.customerName, 'Empresa Demo');
  assert.equal(state.data.companyName, 'Empresa Demo');
  assert.equal(state.data.explicitPriceUsd, 500);
});

test('captura puede extraer negocio y trabajo y usa negocio como cliente si no hay persona', async () => {
  await processQuotationModeText({ identity, text: 'Activa modo cotización' });

  const out = await processQuotationModeImage({
    identity,
    media: { url: 'https://waha.elankav.com/api/files/intake.jpg', mimeType: 'image/jpeg', filename: 'intake.jpg' },
    dependencies: {
      async extractQuotationIntakeFromImage() {
        return {
          customerName: '',
          companyName: 'Venga Baby',
          phone: '87776666',
          email: '',
          address: 'Masaya',
          workDescription: 'Fachada en ACM con letras de cajuela PVC 6 mm',
          productName: 'Fachada',
          confidence: 0.96
        };
      },
      async searchCustomers() { return { data: { results: [] } }; },
      async searchProspects() { return []; }
    }
  });

  assert.equal(out.handled, true);
  assert.match(out.outputText, /Venga Baby/);
  const state = await getState(identity);
  assert.equal(state.data.customerName, 'Venga Baby');
  assert.equal(state.data.companyName, 'Venga Baby');
  assert.equal(state.data.phone, '87776666');
  assert.equal(state.data.address, 'Masaya');
  assert.match(state.data.description, /ACM/);
  assert.equal(state.step, 'paymentTerms');
});

test('sin imagen finaliza creando cliente y cotización oficial', async () => {
  const deps = {
    async searchCustomers() { return { data: { results: [] } }; },
    async searchProspects() { return []; },
    async resolveOrCreateCustomer(data) {
      return {
        customer: {
          id: 'cust-1',
          name: data.customerName,
          companyName: data.companyName,
          phone: data.phone,
          address: data.address
        },
        created: true
      };
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

  await processQuotationModeText({ identity, text: 'Activa modo cotización', dependencies: deps });
  await processQuotationModeText({ identity, text: 'Empresa Demo', dependencies: deps });
  await processQuotationModeText({ identity, text: '78828089', dependencies: deps });
  await processQuotationModeText({ identity, text: 'Fachada ACM 2 x 1 m con letras PVC', dependencies: deps });
  await processQuotationModeText({ identity, text: '60/40', dependencies: deps });
  await processQuotationModeText({ identity, text: 'Managua', dependencies: deps });
  await processQuotationModeText({ identity, text: 'USD 500', dependencies: deps });
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
