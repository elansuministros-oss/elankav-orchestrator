const test = require('node:test');
const assert = require('node:assert/strict');

const {
  handleVqsQuotationSummaryApi,
  mapQuotationSummary,
  normalizeLimit
} = require('../api/vqsQuotationSummaryApi');

test('mapea cliente y ejecutivo completos desde snapshots persistidos', () => {
  const row = mapQuotationSummary({
    id: 'quotation-1',
    quotation_number: 'COT-20260719-00015',
    customer_id: 'customer-1',
    executive_id: 'EXEC-ERICK-CANO-001',
    platform_id: 'ELANVISUAL',
    status: 'draft',
    issued_at: '2026-07-18T00:00:00.000Z',
    total_usd: 130,
    customer_snapshot: {
      name: 'María López',
      companyName: 'López Comercial',
      phone: '+505 8888 0000',
      email: 'maria@example.com'
    },
    executive_snapshot: {
      name: 'Erick Cano',
      phone: '+505 7882 8089',
      email: 'ventas@example.com'
    }
  }, {
    id: 'project-1',
    project_number: 'PRY-2026-000015',
    platform_id: 'ELANVISUAL'
  });

  assert.equal(row.id, 'project-1');
  assert.equal(row.customerName, 'María López');
  assert.equal(row.customerCompanyName, 'López Comercial');
  assert.equal(row.customerPhone, '+505 8888 0000');
  assert.equal(row.executiveName, 'Erick Cano');
  assert.deepEqual(row.customer, {
    id: 'customer-1',
    name: 'María López',
    companyName: 'López Comercial',
    phone: '+505 8888 0000',
    email: 'maria@example.com'
  });
  assert.equal(row.executive.id, 'EXEC-ERICK-CANO-001');
});

test('conserva aliases vacíos sin inventar datos ausentes', () => {
  const row = mapQuotationSummary({
    id: 'quotation-2',
    quotation_number: 'COT-EMPTY',
    platform_id: 'ELANVISUAL'
  }, { id: 'project-2', platform_id: 'ELANVISUAL' });

  assert.equal(row.customerName, '');
  assert.equal(row.customerPhone, '');
  assert.equal(row.executiveName, '');
  assert.equal(row.customer.name, '');
  assert.equal(row.executive.name, '');
});

test('normaliza límite entre 1 y 200', () => {
  assert.equal(normalizeLimit('0'), 1);
  assert.equal(normalizeLimit('500'), 200);
  assert.equal(normalizeLimit('25'), 25);
  assert.equal(normalizeLimit('invalid', 100), 100);
});

test('GET de listado devuelve resumen completo y respeta plataforma', async () => {
  const sent = [];
  const adapter = {
    async listQuotations() {
      return [{
        id: 'quotation-1',
        quotation_number: 'COT-1',
        platform_id: 'ELANVISUAL',
        status: 'draft',
        total_usd: 130,
        customer_snapshot: { name: 'Cliente Real', phone: '+505 8000 0000' },
        executive_snapshot: { name: 'Erick Cano' }
      }];
    },
    async getProjectByQuotationId() {
      return { id: 'project-1', platform_id: 'ELANVISUAL' };
    }
  };

  const handled = await handleVqsQuotationSummaryApi({
    req: {
      method: 'GET',
      url: '/api/vqs/projects?platform=ELANVISUAL&limit=200',
      headers: { 'x-elankav-platform': 'ELANVISUAL' }
    },
    res: {},
    sendJson(_res, status, payload) { sent.push({ status, payload }); },
    services: { adapter }
  });

  assert.equal(handled, true);
  assert.equal(sent[0].status, 200);
  assert.equal(sent[0].payload.count, 1);
  assert.equal(sent[0].payload.data[0].customer.name, 'Cliente Real');
  assert.equal(sent[0].payload.data[0].customerPhone, '+505 8000 0000');
  assert.equal(sent[0].payload.data[0].executiveName, 'Erick Cano');
});
