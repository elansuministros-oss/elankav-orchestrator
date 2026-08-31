'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const discovery = require('../services/elanMarketplaceDiscoveryService');
const worker = require('../services/elanMarketplaceBrokerWorkerService');
const sourceVerification = require('../services/elanMarketplaceSourceVerificationService');
const interestOutreach = require('../services/elanMarketplaceInterestOutreachService');
const buyerHunter = require('../services/elanMarketplaceBuyerHunterService');

test('radar normaliza ofertas y demandas reales', () => {
  const offer = discovery.normalizeDiscovery({
    kind: 'offer',
    title: 'Pickup en venta',
    category: 'vehicle',
    subcategory: 'pickup',
    operation: 'sale',
    priceAmount: 18000,
    priceCurrency: 'USD',
    sourceName: 'Marketplace',
    sourceUrl: 'https://example.com/pickup',
    confidence: 'high'
  }, {
    kind: 'offer',
    category: 'vehicle',
    focus: 'pickups',
    region: 'Nicaragua'
  });

  assert.equal(offer.kind, 'offer');
  assert.equal(offer.operation, 'sale');
  assert.equal(offer.priceCurrency, 'USD');

  const demand = discovery.normalizeDiscovery({
    kind: 'demand',
    title: 'Empresa busca pickup',
    category: 'vehicle',
    subcategory: 'pickup',
    intent: 'purchase',
    sourceName: 'Directorio público',
    sourceUrl: 'https://example.org/rfq',
    confidence: 'medium'
  }, {
    kind: 'demand',
    category: 'vehicle',
    focus: 'pickups',
    region: 'Nicaragua'
  });

  assert.equal(demand.kind, 'demand');
  assert.equal(demand.intent, 'purchase');
});

test('radar descarta hallazgos sin URL HTTPS o con categoría inventada', () => {
  assert.equal(
    discovery.normalizeDiscovery({
      kind: 'offer',
      title: 'Oferta dudosa',
      category: 'vehicle',
      subcategory: 'pickup',
      operation: 'sale',
      sourceName: 'Fuente',
      sourceUrl: 'http://inseguro.test'
    }, {
      kind: 'offer',
      category: 'vehicle',
      focus: 'pickups'
    }),
    null
  );

  assert.equal(
    discovery.normalizeDiscovery({
      kind: 'offer',
      title: 'Oferta incorrecta',
      category: 'machinery',
      subcategory: 'loader',
      operation: 'sale',
      sourceName: 'Fuente',
      sourceUrl: 'https://example.com/loader'
    }, {
      kind: 'offer',
      category: 'vehicle',
      focus: 'pickups'
    }),
    null
  );
});

test('ciclo autónomo busca oferta y demanda y publica ambas', async () => {
  const persisted = [];

  const result = await discovery.runAutonomousDiscoveryCycle({
    env: {
      ELAN_MARKETPLACE_DISCOVERY_SEARCHES_PER_RUN: '2',
      ELAN_MARKETPLACE_DISCOVERY_INTERVAL_MS: '900000'
    },
    now: 1_800_000,
    searchWeb: async (target) => ({
      discoveries: [
        {
          kind: target.kind,
          title: target.kind === 'offer'
            ? 'Oferta real encontrada'
            : 'Demanda real encontrada',
          category: target.category,
          subcategory: 'test',
          ...(target.kind === 'offer'
            ? { operation: 'sale' }
            : { intent: 'purchase' }),
          sourceName: 'Fuente pública',
          sourceUrl: target.kind === 'offer'
            ? 'https://example.com/offer'
            : 'https://example.com/demand',
          confidence: 'high'
        }
      ],
      searchSummary: 'ok'
    }),
    verifySource: async () => ({
      verified: true,
      code: 'SOURCE_CONFIRMED',
      statusCode: 200,
      finalUrl: 'https://example.com/confirmed',
      pageTitle: 'Oferta real encontrada',
      sourceDescription: 'Publicación original confirmada',
      imageUrl: 'https://example.com/image-1.jpg',
      imageUrls: [
        'https://example.com/image-1.jpg',
        'https://example.com/image-2.jpg',
        'https://example.com/image-3.jpg'
      ],
      priceConfirmed: false,
      locationConfirmed: false,
      contactConfirmed: false,
      verifiedAt: '2026-08-31T01:00:00.000Z'
    }),
    persist: async (item) => {
      persisted.push(item);
      return {
        result: {
          discoveryCode: `DISC-${String(persisted.length).padStart(6, '0')}`
        }
      };
    }
  });

  assert.equal(result.searches, 2);
  assert.equal(result.published, 2);
  assert.equal(persisted[0].verificationStatus, 'validated');
  assert.equal(persisted[0].imageUrl, 'https://example.com/image-1.jpg');
  assert.equal(persisted[0].imageUrls.length, 3);
  assert.equal(persisted[0].kind, 'offer');
  assert.equal(persisted[1].kind, 'demand');
});

test('verificación compara título y precio contra la fuente', () => {
  const html = '<html><head><meta property="og:title" content="Toyota Hilux 2024 en venta"><meta property="og:image" content="https://cdn.example.com/hilux.jpg"></head><body>Managua. Precio US$ 28,500. Toyota Hilux 2024.</body></html>';
  const text = sourceVerification.stripHtml(html);
  assert.equal(
    sourceVerification.titleConfirmed('Toyota Hilux 2024', 'Toyota Hilux 2024 en venta', text),
    true
  );
  assert.equal(sourceVerification.priceConfirmed(28500, text), true);
  assert.equal(
    sourceVerification.locationConfirmed({ country: 'Nicaragua', department: 'Managua' }, text),
    true
  );
  assert.equal(
    sourceVerification.extractMeta(html, ['og:image']),
    'https://cdn.example.com/hilux.jpg'
  );
});

test('verificación rechaza coincidencias de título insuficientes', () => {
  assert.equal(
    sourceVerification.titleConfirmed(
      'Montacargas Toyota 3 toneladas',
      'Casa en venta en Managua',
      'propiedad residencial con tres habitaciones'
    ),
    false
  );
});

test('buyer hunter cruza ofertas con demandas internas compatibles', () => {
  assert.equal(
    buyerHunter.internalDemandCompatible(
      {
        category: 'vehicle',
        subcategory: 'pickup',
        title: 'Toyota Hilux 2026'
      },
      {
        category: 'vehicle',
        subcategory: 'pickup',
        title: 'Busco pickup para empresa'
      }
    ),
    true
  );

  assert.equal(
    buyerHunter.internalDemandCompatible(
      {
        category: 'vehicle',
        subcategory: 'pickup',
        title: 'Toyota Hilux 2026'
      },
      {
        category: 'real_estate',
        subcategory: 'house',
        title: 'Busco casa'
      }
    ),
    false
  );
});

test('buyer hunter guarda demanda interna y comprador web confirmado', async () => {
  const persisted = [];

  const result = await buyerHunter.runBuyerHuntForOffer({
    offer: {
      discoveryCode: 'DISC-000010',
      kind: 'offer',
      title: 'Toyota Hilux 2026',
      category: 'vehicle',
      subcategory: 'pickup',
      operation: 'sale'
    },
    listDemands: async () => ({
      result: [{
        demandCode: 'NIC-DEMAND-000007',
        title: 'Empresa busca pickup',
        category: 'vehicle',
        subcategory: 'pickup',
        status: 'active'
      }]
    }),
    searchWeb: async () => ({
      buyers: [{
        buyerName: 'Empresa logística',
        buyerNeed: 'Empresa logística busca pickup para operaciones',
        sourceName: 'Solicitud pública',
        sourceUrl: 'https://example.org/rfq/pickup',
        contactHint: '+505 8111 1111',
        confidence: 'high'
      }]
    }),
    verifyWebBuyer: async () => ({
      validated: true,
      finalUrl: 'https://example.org/rfq/pickup',
      verifiedAt: '2026-08-31T02:00:00.000Z'
    }),
    persist: async (item) => {
      persisted.push(item);
      return {
        result: {
          candidateCode: 'BUYER-' + String(persisted.length).padStart(6, '0')
        }
      };
    }
  });

  assert.equal(result.internalCandidates, 1);
  assert.equal(result.webCandidates, 1);
  assert.equal(result.persisted, 2);
  assert.equal(persisted[0].sourceKind, 'internal_demand');
  assert.equal(persisted[1].sourceKind, 'web');
  assert.equal(persisted[1].verificationStatus, 'validated');
});

test('mensaje al propietario identifica a ELAN como IA intermediaria y negocia comisión', () => {
  const message = interestOutreach.sellerNegotiationMessage({
    title: 'Toyota Hilux 2026'
  });

  assert.match(message, /IA intermediaria/i);
  assert.match(message, /precio neto o comisión/i);
  assert.match(message, /cliente interesado/i);
});

test('worker procesa intereses de clientes cuando outreach está habilitado', async () => {
  let interestCalls = 0;

  const result = await worker.runElanMarketplaceBrokerWorkerOnce({
    env: {
      ELAN_MARKETPLACE_DISCOVERY_INTERVAL_MS: '900000'
    },
    now: 11_000_000,
    getControl: async () => ({
      enabled: true,
      spendEnabled: true,
      outreachEnabled: true
    }),
    recordHeartbeat: async () => ({ ok: true }),
    processInterests: async () => {
      interestCalls += 1;
      return {
        ok: true,
        processed: 1,
        contacted: 1,
        results: [{ state: 'SELLER_CONTACTED' }]
      };
    },
    runDiscovery: async () => ({
      ok: true,
      category: 'vehicle',
      searches: 0,
      published: 0,
      results: []
    }),
    runBuyerHunter: async () => ({
      ok: true,
      offersScanned: 0,
      buyersFound: 0,
      results: []
    }),
    listDemands: async () => ({ result: [] })
  });

  assert.equal(interestCalls, 1);
  assert.equal(result.interests.processed, 1);
  assert.equal(result.interests.contacted, 1);
});

test('worker ejecuta radar aunque CONNECT tenga cero demandas internas', async () => {
  let discoveryCalls = 0;
  let demandListCalls = 0;

  const result = await worker.runElanMarketplaceBrokerWorkerOnce({
    env: {
      ELAN_MARKETPLACE_DISCOVERY_INTERVAL_MS: '900000'
    },
    now: 20_000_000,
    getControl: async () => ({
      enabled: true,
      spendEnabled: true,
      outreachEnabled: false
    }),
    recordHeartbeat: async () => ({ ok: true }),
    runDiscovery: async () => {
      discoveryCalls += 1;
      return {
        ok: true,
        category: 'vehicle',
        searches: 2,
        published: 3,
        results: []
      };
    },
    runBuyerHunter: async () => ({
      ok: true,
      offersScanned: 1,
      buyersFound: 2,
      results: []
    }),
    listDemands: async () => {
      demandListCalls += 1;
      return { result: [] };
    }
  });

  assert.equal(discoveryCalls, 1);
  assert.equal(demandListCalls, 1);
  assert.equal(result.activeDemands, 0);
  assert.equal(result.discoverySearches, 2);
  assert.equal(result.publishedDiscoveries, 3);
  assert.equal(result.state, 'DISCOVERY_PUBLISHED');
});
