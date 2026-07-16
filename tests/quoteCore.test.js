import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteProject, validateQuoteProject } from '../modules/quoteCore/quoteProjectContract.js';
import { canCreatePurchaseOrder, canCreateWorkOrder, filterQuoteForActor } from '../services/quoteCore/quoteAccessPolicyService.js';
import { createProjectEvent } from '../services/quoteCore/projectEventService.js';

test('crea una cotización nueva con proyecto pendiente', () => {
  const quote = createQuoteProject({
    quotation: {
      platformId: 'ELANVISUAL',
      source: { type: 'design', sourceId: 'DES-001', designMode: 'required' }
    },
    relations: {
      customerId: '11111111-1111-1111-1111-111111111111',
      executiveId: '22222222-2222-2222-2222-222222222222'
    },
    items: [{ title: 'Rótulo', quantity: 1, unitPriceUsd: 500 }],
    pricing: { exchangeRate: 36.8 },
    paymentTerms: {
      type: '60_40',
      installments: [
        { percentage: 60, label: 'Anticipo' },
        { percentage: 40, label: 'Contra entrega' }
      ]
    }
  });

  assert.equal(validateQuoteProject(quote).ok, true);
  assert.equal(quote.pricing.totalUsd, 500);
  assert.equal(quote.pricing.payableTotalNio, 18400);
  assert.equal(quote.project.status, 'pending_activation');
});

test('el ejecutivo genera OT solo después del anticipo confirmado', () => {
  const quote = createQuoteProject({
    quotation: {
      status: 'deposit_confirmed',
      source: { type: 'manual' }
    },
    project: { projectId: 'PROJ-001' },
    relations: { customerId: 'C-1', executiveId: 'E-1' },
    items: [{ title: 'Producto', quantity: 1, unitPriceUsd: 100 }],
    pricing: { exchangeRate: 36.8 }
  });

  assert.equal(canCreateWorkOrder({ actor: { role: 'ventas', executiveId: 'E-1' }, quote }), true);
  assert.equal(canCreateWorkOrder({ actor: { role: 'ventas', executiveId: 'E-2' }, quote }), false);
  assert.equal(canCreatePurchaseOrder({ actor: { role: 'ventas', executiveId: 'E-1' }, quote }), false);
  assert.equal(canCreatePurchaseOrder({ actor: { role: 'admin' }, quote }), true);
});

test('oculta datos internos al ejecutivo', () => {
  const quote = createQuoteProject({
    quotation: { source: { type: 'store' } },
    relations: { customerId: 'C-1', executiveId: 'E-1' },
    items: [{ title: 'Producto', quantity: 1, unitPriceUsd: 100, internalData: { supplierCost: 40 } }],
    pricing: { exchangeRate: 36.8 }
  });

  const filtered = filterQuoteForActor({ actor: { role: 'ventas', executiveId: 'E-1' }, quote });
  assert.equal('internalData' in filtered.items[0], false);
});

test('crea evento auditable', () => {
  const event = createProjectEvent({
    quotationId: 'Q-1',
    type: 'quotation.sent',
    actorId: 'E-1',
    actorRole: 'ventas'
  });

  assert.equal(event.type, 'quotation.sent');
  assert.ok(event.eventId);
});
