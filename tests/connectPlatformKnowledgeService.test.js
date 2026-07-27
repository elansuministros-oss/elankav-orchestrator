'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  fetchPlatformKnowledge,
  normalizePlatform
} = require('../services/connectPlatformKnowledgeService');
const {
  loadCommercialContext,
  resolveKnowledgePlatform
} = require('../services/commercialContextService');

test('normaliza plataformas oficiales de CONNECT', () => {
  assert.equal(normalizePlatform('ELANVISUAL'), 'elanvisual');
  assert.equal(normalizePlatform('home'), 'elanhome');
  assert.equal(normalizePlatform('ELANPET'), 'elanpet');
  assert.equal(resolveKnowledgePlatform('CONNECT'), 'connect');
});

test('consulta el endpoint de contexto aprobado de CONNECT', async () => {
  let requestedUrl = null;
  const fetchFn = async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      platformId: 'elanvisual',
      policy: 'approved-commercial-catalogs-only',
      items: [{ item_type: 'PRODUCT', title: 'Banner' }]
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };

  const result = await fetchPlatformKnowledge({
    platform: 'ELANVISUAL',
    query: 'precio de banner',
    fetchFn
  });

  assert.match(
    requestedUrl,
    /\/console\/api\/ai-platforms\/elanvisual\/context\?q=precio\+de\+banner$/
  );
  assert.equal(result.available, true);
  assert.equal(result.policy, 'approved-commercial-catalogs-only');
  assert.equal(result.payload.items[0].title, 'Banner');
});

test('incorpora conocimiento de CONNECT aunque no exista oferta legado', async () => {
  const commercial = await loadCommercialContext(
    {
      message: '¿Qué rótulos ofrecen?',
      history: [],
      platform: 'ELANVISUAL'
    },
    {
      fetchOffer: async () => null,
      loadKnowledge: async ({ platform, query }) => ({
        available: true,
        source: 'ELANKAV_CONNECT',
        policy: 'approved-commercial-catalogs-only',
        platformId: platform,
        query,
        payload: {
          items: [
            {
              item_type: 'PRODUCT',
              title: 'Rótulo jala vista',
              content: 'Rótulo comercial doble cara'
            }
          ]
        }
      })
    }
  );

  assert.equal(commercial.available, true);
  assert.equal(commercial.platformKnowledge.platformId, 'elanvisual');
  assert.equal(
    commercial.platformKnowledge.payload.items[0].title,
    'Rótulo jala vista'
  );
});

test('mantiene operación cuando CONNECT no está disponible', async () => {
  const commercial = await loadCommercialContext(
    { message: 'consulta', platform: 'ELANVISUAL' },
    {
      fetchOffer: async () => ({
        source: 'legacy',
        productId: 'p-1',
        productName: 'Producto verificado',
        priceOffers: []
      }),
      loadKnowledge: async () => {
        throw new Error('CONNECT_UNAVAILABLE');
      }
    }
  );

  assert.equal(commercial.productName, 'Producto verificado');
  assert.equal(commercial.platformKnowledge, null);
});
