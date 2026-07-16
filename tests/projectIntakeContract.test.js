const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VQS_PROJECT_INTAKE_VERSION,
  normalizeProjectIntake,
  validateProjectIntake,
  toQuoteProjectInput
} = require('../modules/vqs/projectIntakeContract');

function validInput() {
  return {
    platform: 'elanvisual',
    source: { type: 'design', designRequestId: 'design-1' },
    customer: { customerId: 'customer-1', name: 'Cliente' },
    executive: { executiveId: 'exec-1', name: 'Valentina' },
    project: { title: 'Fachada', images: ['https://example.com/project.jpg'] },
    items: [{
      title: 'Rótulo de fachada',
      quantity: 1,
      unitPriceUsd: 500,
      imageUrl: 'https://example.com/item.jpg',
      images: ['https://example.com/item-2.jpg']
    }],
    pricing: { exchangeRate: 36.6243 },
    payments: {
      type: 'custom',
      installments: [
        { label: 'Anticipo', percentage: 60 },
        { label: 'Saldo', percentage: 40 }
      ]
    }
  };
}

test('VQS Project Intake normaliza plataforma, imágenes y monedas', () => {
  const contract = normalizeProjectIntake(validInput());
  assert.equal(contract.contractVersion, VQS_PROJECT_INTAKE_VERSION);
  assert.equal(contract.platform, 'ELANVISUAL');
  assert.equal(contract.pricing.currency, 'USD');
  assert.equal(contract.pricing.settlementCurrency, 'NIO');
  assert.equal(contract.project.images.length, 1);
  assert.equal(contract.items[0].images.length, 1);
});

test('VQS Project Intake valida contrato completo', () => {
  const validation = validateProjectIntake(normalizeProjectIntake(validInput()));
  assert.deepEqual(validation, { ok: true, errors: [] });
});

test('VQS Project Intake rechaza cuotas que no suman 100%', () => {
  const input = validInput();
  input.payments.installments[1].percentage = 30;
  const validation = validateProjectIntake(normalizeProjectIntake(input));
  assert.equal(validation.ok, false);
  assert.match(validation.errors.join(' '), /100%/);
});

test('VQS Project Intake transforma al contrato interno sin lógica de plataforma', () => {
  const internal = toQuoteProjectInput(normalizeProjectIntake(validInput()));
  assert.equal(internal.quotation.platformId, 'ELANVISUAL');
  assert.equal(internal.quotation.source.type, 'design');
  assert.equal(internal.project.currentStage, 'quotation');
  assert.equal(internal.relations.designRequestId, 'design-1');
  assert.equal(internal.items[0].title, 'Rótulo de fachada');
});
