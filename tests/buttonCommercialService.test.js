'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  detectButtonCommercialIntent,
  detectVariantId,
  extractSize,
  processButtonCommercialConversation
} = require('../services/buttonCommercialService');

function offerFixture(sizeCm = 60, manualReview = false) {
  const prices = [100, 130, 150, 190];
  const names = [
    ['boton-transparente', 'Botón Transparente'],
    ['boton-con-impresion', 'Botón con Impresión'],
    ['boton-impresion-uv-premium', 'Botón Impresión UV Premium'],
    ['boton-premium-combinado', 'Botón Premium Combinado']
  ];
  const increments = (sizeCm - 60) / 10;

  return {
    status: 'active',
    source: 'ELANKAV Commercial Library',
    productId: 'boton-acrilico',
    productVersion: 'ECL-001A',
    productName: 'Rótulo estilo botón en acrílico',
    effectiveSizeCm: sizeCm,
    baseSizeUsed: sizeCm === 60,
    dimensions: {
      baseCm: 60,
      maxStandardCm: 120
    },
    materialRules: {
      thicknessMm: 3,
      interiorDefault: true
    },
    pricingRule: {
      currency: 'USD',
      incrementAmount: 20
    },
    commercialRules: {
      paymentAdvancePercent: 60,
      paymentBalancePercent: 40
    },
    variants: names.map(([id, name], index) => ({
      id,
      name,
      quote: manualReview
        ? {
            status: 'manual-review',
            currency: 'USD',
            reason: 'NON_STANDARD_SIZE_STEP'
          }
        : {
            status: 'priced',
            currency: 'USD',
            total: prices[index] + increments * 20
          }
    }))
  };
}

function successfulDependency(sizeCm = 60, manualReview = false) {
  return async () => ({
    ok: true,
    status: 'COMMERCIAL_OFFER_READY',
    offer: offerFixture(sizeCm, manualReview)
  });
}

test('detecta botón actual o seguimiento comercial con historial', () => {
  assert.equal(
    detectButtonCommercialIntent({
      message: 'Me interesa el rótulo acrílico estilo botón'
    }).detected,
    true
  );

  assert.equal(
    detectButtonCommercialIntent({
      message: '¿Cuánto cuesta el rótulo estilo botón?'
    }).detected,
    true
  );

  assert.equal(
    detectButtonCommercialIntent({
      message: '¿Y cuánto cuesta el de 70 cm?',
      history: [{
        role: 'assistant',
        content: 'Información del rótulo estilo botón'
      }]
    }).detected,
    true
  );

  assert.equal(
    detectButtonCommercialIntent({
      message: 'Necesito alimento para mascotas'
    }).detected,
    false
  );
});

test('jala vista nunca entra al cotizador del botón', () => {
  const result = detectButtonCommercialIntent({
    message: 'Quiero cotizar el rótulo jala vista doble cara de USD 260',
    history: [{
      role: 'assistant',
      content: 'Precios del rótulo estilo botón'
    }]
  });

  assert.equal(result.detected, false);
  assert.equal(result.reason, 'DIFFERENT_PRODUCT_JALA_VISTA');
});

test('no bloquea una solicitud dedicada de diseño', () => {
  const result = detectButtonCommercialIntent({
    message: 'Diseñame un rótulo estilo botón para mi logo'
  });

  assert.equal(result.detected, false);
  assert.equal(result.reason, 'DESIGN_INTENT_HAS_PRIORITY');
});

test('extrae medida y variante sin confundir colores', () => {
  assert.deepEqual(
    extractSize('Quiero uno de 70 x 70 cm'),
    {
      sizeCm: 70,
      widthCm: 70,
      heightCm: 70,
      nonSquare: false
    }
  );
  assert.equal(
    detectVariantId('botón con impresión full color'),
    'boton-con-impresion'
  );
  assert.equal(
    detectVariantId('negro con luz dorada'),
    null
  );
});

test('responde tabla oficial completa en medida base', async () => {
  const result = await processButtonCommercialConversation(
    {
      message: '¿Cuánto cuesta el rótulo estilo botón?'
    },
    {
      fetchCommercialOffer: successfulDependency(60)
    }
  );

  assert.equal(result.handled, true);
  assert.match(result.outputText, /Botón Transparente: USD 100/);
  assert.match(result.outputText, /Botón con Impresión: USD 130/);
  assert.match(result.outputText, /Botón Impresión UV Premium: USD 150/);
  assert.match(result.outputText, /Botón Premium Combinado: USD 190/);
  assert.match(result.outputText, /60% de anticipo y 40% de saldo/);
});

test('calcula variante confirmada a 70 cm', async () => {
  const result = await processButtonCommercialConversation(
    {
      message:
        '¿Cuánto cuesta el rótulo estilo botón con impresión de 70 cm para interior?'
    },
    {
      fetchCommercialOffer: successfulDependency(70)
    }
  );

  assert.match(
    result.outputText,
    /Botón con Impresión de 70 × 70 cm: USD 150/
  );
  assert.doesNotMatch(result.outputText, /¿Lo instalarás/);
});

test('nunca inventa precio para medida no estándar o exterior', async () => {
  const nonStandard = await processButtonCommercialConversation(
    {
      message: 'Precio del rótulo estilo botón de 65 cm'
    },
    {
      fetchCommercialOffer: successfulDependency(65, true)
    }
  );

  assert.match(nonStandard.outputText, /revisión manual/);
  assert.doesNotMatch(nonStandard.outputText, /USD \d+/);

  const exterior = await processButtonCommercialConversation(
    {
      message: 'Precio del rótulo estilo botón para exterior'
    },
    {
      fetchCommercialOffer: successfulDependency(60)
    }
  );

  assert.match(exterior.outputText, /Para exterior necesitamos validar/);
  assert.doesNotMatch(exterior.outputText, /USD \d+/);
});

test('degrada de forma controlada si la biblioteca no responde', async () => {
  const result = await processButtonCommercialConversation(
    {
      message: '¿Cuánto cuesta el rótulo estilo botón?'
    },
    {
      fetchCommercialOffer: async () => ({
        ok: false,
        status: 'COMMERCIAL_LIBRARY_UNAVAILABLE'
      })
    }
  );

  assert.equal(result.handled, true);
  assert.equal(result.completed, false);
  assert.match(result.outputText, /verificar el cotizador oficial/);
  assert.doesNotMatch(result.outputText, /USD \d+/);
});
