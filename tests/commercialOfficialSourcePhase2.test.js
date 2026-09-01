const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MemoryCommercialStateRepository,
  hashPhone
} = require('../services/commercialStateRepository');
const {
  createEmptyCommercialState,
  loadCommercialContext,
  loadPersistentCommercialState,
  resolveCommercialConversationKey,
  savePersistentCommercialState,
  setCommercialStateRepositoryForTests,
  updateCommercialState
} = require('../services/commercialContextService');

test('commercial state repository persists multiproduct state after cache reset', async () => {
  const repository = new MemoryCommercialStateRepository();
  setCommercialStateRepositoryForTests(repository);
  const key = resolveCommercialConversationKey({
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: 'cliente-1'
  });
  const state = {
    ...createEmptyCommercialState({ platform: 'ELANVISUAL' }),
    activeItemId: 'item-2',
    items: [
      { id: 'item-1', sku: 'lona-banner', product: 'Lona banner', quantity: 1 },
      { id: 'item-2', sku: 'rotulo-jala-vista', product: 'Rotulo jala vista', quantity: 2 }
    ],
    sku: 'rotulo-jala-vista',
    product: 'Rotulo jala vista'
  };

  await savePersistentCommercialState(key, state, {
    platform: 'ELANVISUAL',
    channel: 'whatsapp',
    externalUserId: 'cliente-1',
    phone: '+505 8888 7777'
  });
  setCommercialStateRepositoryForTests(repository);

  const restored = await loadPersistentCommercialState(key);
  assert.equal(restored.activeItemId, 'item-2');
  assert.equal(restored.items.length, 2);
  assert.equal(hashPhone('+505 8888 7777').length, 64);
});

test('commercial context uses Core official product with approved tariff', async () => {
  setCommercialStateRepositoryForTests(new MemoryCommercialStateRepository());
  const commercial = await loadCommercialContext({
    message: 'Necesito una lona banner',
    platform: 'ELANVISUAL'
  }, {
    loadKnowledge: async () => null,
    fetchOffer: async () => ({
      available: true,
      source: 'Supabase Commercial Products',
      productId: 'lona-banner',
      productName: 'Lona banner',
      category: 'IMPRESION',
      priceOffers: [{ amount: 12, currency: 'USD', mode: 'AREA_M2' }],
      formulaType: 'AREA_M2',
      calculation: { formulaType: 'AREA_M2', pricePerM2: 12, minimumPrice: 25 },
      priceSource: { source: 'tabla-lonas-2026', approved: true, status: 'OFFICIAL' }
    })
  });

  assert.equal(commercial.productId, 'lona-banner');
  assert.equal(commercial.formulaType, 'AREA_M2');
  assert.equal(commercial.priceSource.approved, true);
});

test('commercial context does not use local fallback when Core finds product without approved tariff', async () => {
  const previous = process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED;
  process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED = 'true';
  const commercial = await loadCommercialContext({
    message: 'Necesito una fachada ACM',
    platform: 'ELANVISUAL'
  }, {
    loadKnowledge: async () => null,
    fetchOffer: async () => ({
      available: true,
      source: 'Supabase Commercial Products',
      productId: 'fachada-acm',
      productName: 'Fachada ACM',
      category: 'FACHADAS',
      priceOffers: [],
      formulaType: 'AREA_M2',
      calculation: { formulaType: 'AREA_M2' },
      priceSource: {
        source: 'referencia-historica-1450',
        approved: false,
        status: 'NO_APPROVED_TARIFF'
      }
    })
  });
  process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED = previous;

  const state = updateCommercialState({
    previousState: null,
    message: 'Necesito una fachada ACM de 6x1.2 m',
    commercial,
    platform: 'ELANVISUAL'
  });

  assert.equal(commercial.source, 'Supabase Commercial Products');
  assert.equal(commercial.priceOffers.length, 0);
  assert.equal(state.verifiedPrice, null);
  assert.equal(state.calculationBreakdown.missing, 'approvedOfficialTariff');
});

test('commercial context uses local fallback only when Core is unavailable and env enables it', async () => {
  const previous = process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED;
  process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED = 'true';
  const commercial = await loadCommercialContext({
    message: 'Necesito un jala vista',
    platform: 'ELANVISUAL'
  }, {
    loadKnowledge: async () => null,
    fetchOffer: async () => {
      const error = new Error('core down');
      error.code = 'COMMERCIAL_LIBRARY_UNAVAILABLE';
      throw error;
    }
  });
  process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED = previous;

  assert.equal(commercial.productId, 'rotulo-jala-vista');
  assert.equal(commercial.priceSource.status, 'LOCAL_FALLBACK');
});

test('commercial context returns null when Core is unavailable and fallback is disabled', async () => {
  const previous = process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED;
  process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED = 'false';
  const commercial = await loadCommercialContext({
    message: 'Necesito un jala vista',
    platform: 'ELANVISUAL'
  }, {
    loadKnowledge: async () => null,
    fetchOffer: async () => {
      const error = new Error('core down');
      error.code = 'COMMERCIAL_LIBRARY_UNAVAILABLE';
      throw error;
    }
  });
  process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED = previous;

  assert.equal(commercial, null);
});
