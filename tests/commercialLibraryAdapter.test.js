'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  fetchCommercialOffer,
  isValidOffer
} = require('../adapters/commercialLibraryAdapter');

function offerFixture(sizeCm = 60) {
  return {
    status: 'active',
    source: 'ELANKAV Commercial Library',
    productId: 'boton-acrilico',
    productVersion: 'ECL-001A',
    effectiveSizeCm: sizeCm,
    dimensions: {
      baseCm: 60,
      maxStandardCm: 120
    },
    materialRules: {
      thicknessMm: 3
    },
    pricingRule: {
      currency: 'USD',
      incrementAmount: 20
    },
    commercialRules: {
      paymentAdvancePercent: 60,
      paymentBalancePercent: 40
    },
    variants: [
      ['boton-transparente', 'Botón Transparente', 100],
      ['boton-con-impresion', 'Botón con Impresión', 130],
      ['boton-impresion-uv-premium', 'Botón Impresión UV Premium', 150],
      ['boton-premium-combinado', 'Botón Premium Combinado', 190]
    ].map(([id, name, total]) => ({
      id,
      name,
      quote: {
        status: 'priced',
        currency: 'USD',
        total
      }
    }))
  };
}

test('adapter acepta únicamente oferta oficial válida', () => {
  assert.equal(
    isValidOffer(offerFixture(), 'boton-acrilico'),
    true
  );
  assert.equal(
    isValidOffer(
      { ...offerFixture(), source: 'cliente' },
      'boton-acrilico'
    ),
    false
  );
});

test('adapter consulta producto y medida en ELANKAV Core', async () => {
  let captured = null;

  const result = await fetchCommercialOffer(
    {
      productId: 'boton-acrilico',
      sizeCm: 70
    },
    {
      url: 'https://core.test/api/commercial-library',
      fetchImpl: async (url, options) => {
        captured = { url, options };

        return new Response(
          JSON.stringify({
            success: true,
            result: offerFixture(70)
          }),
          {
            status: 200,
            headers: {
              'content-type': 'application/json'
            }
          }
        );
      }
    }
  );

  assert.equal(result.ok, true);
  assert.equal(result.status, 'COMMERCIAL_OFFER_READY');
  assert.equal(
    captured.url,
    'https://core.test/api/commercial-library?productId=boton-acrilico&sizeCm=70'
  );
  assert.equal(captured.options.method, 'GET');
});

test('adapter rechaza una oferta manipulada', async () => {
  const result = await fetchCommercialOffer(
    { productId: 'boton-acrilico' },
    {
      fetchImpl: async () => new Response(
        JSON.stringify({
          success: true,
          result: {
            ...offerFixture(),
            variants: offerFixture().variants.map((variant, index) =>
              index === 0
                ? {
                    ...variant,
                    quote: {
                      ...variant.quote,
                      total: 'inventado'
                    }
                  }
                : variant
            )
          }
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json'
          }
        }
      )
    }
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, 'COMMERCIAL_LIBRARY_INVALID_OFFER');
});
