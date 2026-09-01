'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { buildPricingCorrectionLine } = require('../services/commercialReplyService');
const {
  createEmptyCommercialState,
  updateCommercialState
} = require('../services/commercialContextService');
const {
  findProductDefinition
} = require('../services/commercialProductKnowledge');

function offer(sku, overrides = {}) {
  const product = findProductDefinition({ sku, productId: sku });
  return Object.freeze({
    available: true,
    source: product?.source || 'ELANKAV Commercial Matrix',
    productId: sku,
    productName: product?.productName || sku,
    description: product?.productName || sku,
    specifications: {},
    priceOffers: product?.minimumPrice
      ? [{
          label: product.productName,
          amount: product.minimumPrice,
          currency: product.currency,
          mode: product.approved ? 'reference' : 'starting-at',
          approximate: !product.approved
        }]
      : [],
    ...overrides
  });
}

function nextState(previousState, message, commercial) {
  return updateCommercialState({
    previousState,
    message,
    commercial,
    platform: 'ELANVISUAL'
  });
}

test('1. Jala vista 60x60 usa precio exacto aprobado', () => {
  const state = nextState(null, 'Necesito un jala vista de 60x60 cm', offer('rotulo-jala-vista'));

  assert.equal(state.sku, 'rotulo-jala-vista');
  assert.equal(state.formulaType, 'DIMENSION_STEP');
  assert.equal(state.calculatedPrice, 260);
  assert.equal(state.calculationBreakdown.formula, '260 + (0 * 15)');
});

test('2. Jala vista 60x40 conserva minimo aprobado', () => {
  const state = nextState(null, 'Necesito un jala vista de 60x40 cm', offer('rotulo-jala-vista'));

  assert.equal(state.measurements.area, 0.24);
  assert.equal(state.calculatedPrice, 260);
  assert.equal(state.calculationBreakdown.totalSteps, 0);
});

test('3. Rotulo boton 60x60 usa precio fijo de medida base', () => {
  const state = nextState(null, 'Quiero un rotulo boton de 60x60 cm', offer('boton-acrilico'));

  assert.equal(state.sku, 'boton-acrilico');
  assert.equal(state.formulaType, 'PRECIO_FIJO_CON_MEDIDA_BASE');
  assert.equal(state.calculatedPrice, 100);
  assert.equal(state.baseAreaM2, 0.36);
});

test('4. Caja de luz 1.20x0.60 m requiere tarifa oficial', () => {
  const state = nextState(null, 'Caja de luz de 1.20x0.60 m', offer('caja-de-luz'));

  assert.equal(state.sku, 'caja-de-luz');
  assert.equal(state.formulaType, 'AREA_M2');
  assert.equal(state.measurements.area, 0.72);
  assert.equal(state.calculatedPrice, null);
  assert.equal(state.calculationBreakdown.missing, 'approvedUnitPriceM2');
});

test('5. Fachada ACM 6x1.2 m calcula area pero no precio sin tarifa m2', () => {
  const state = nextState(null, 'Necesito fachada ACM de 6x1.2 m', offer('fachada-acm-luz'));
  const correction = buildPricingCorrectionLine({
    commercial: offer('fachada-acm-luz'),
    commercialState: state,
    message: 'Necesito fachada ACM de 6x1.2 m'
  });

  assert.equal(state.measurements.area, 7.199999999999999);
  assert.equal(state.formulaType, 'AREA_M2');
  assert.equal(state.calculatedPrice, null);
  assert.match(correction.text, /falta definir el precio aprobado por metro cuadrado/i);
});

test('6. Fachada ACM en centimetros se marca atipica', () => {
  const state = nextState(null, 'La fachada ACM seria de 60x40 cm', offer('fachada-acm-luz'));
  const correction = buildPricingCorrectionLine({
    commercial: offer('fachada-acm-luz'),
    commercialState: state,
    message: 'La fachada ACM seria de 60x40 cm'
  });

  assert.equal(state.conversationStatus, 'NEEDS_DIMENSION_CONFIRMATION');
  assert.equal(state.calculationBreakdown.physicalValidation.status, 'ATYPICAL_DIMENSION');
  assert.equal((correction.text.match(/\?/g) || []).length, 1);
});

test('7. Lona banner 3x1 con ojetes conserva area y acabado', () => {
  const state = nextState(null, 'Lona banner 3x1 m con ojetes', offer('lona-banner'));

  assert.equal(state.category, 'IMPRESION');
  assert.equal(state.formulaType, 'AREA_M2');
  assert.equal(state.measurements.area, 3);
  assert.deepEqual(state.finishes, ['OJETES']);
  assert.equal(state.calculatedPrice, null);
});

test('8. Vinil adhesivo 2x1 usa familia impresion sin reutilizar otro precio', () => {
  const state = nextState(null, 'Vinil adhesivo 2x1 m', offer('vinil-adhesivo'));

  assert.equal(state.sku, 'vinil-adhesivo');
  assert.equal(state.category, 'IMPRESION');
  assert.equal(state.measurements.area, 2);
  assert.equal(state.verifiedPrice, null);
});

test('9. Letras PVC 10 letras de 50 cm captura cantidad y altura', () => {
  const state = nextState(null, 'Letras PVC, 10 letras de 50 cm de alto', offer('letras-pvc'));

  assert.equal(state.category, 'LETRAS_LOGOTIPOS');
  assert.equal(state.formulaType, 'CANTIDAD_LETRAS');
  assert.equal(state.letterCount, 10);
  assert.equal(state.letterHeight, 0.5);
  assert.equal(state.calculatedPrice, null);
});

test('10. Letras luminosas 12 letras de 70 cm captura iluminacion', () => {
  const state = nextState(null, 'Letras luminosas, 12 letras de 70 cm de alto', offer('letras-luminosas'));

  assert.equal(state.sku, 'letras-luminosas');
  assert.equal(state.letterCount, 12);
  assert.equal(state.letterHeight, 0.7);
  assert.equal(state.calculationBreakdown.missing, 'approvedPrice');
});

test('11. Totem 3x1 m queda como base mas variable sin parametros aprobados', () => {
  const state = nextState(null, 'Totem 3x1 m', offer('totem'));

  assert.equal(state.sku, 'totem');
  assert.equal(state.formulaType, 'COSTO_BASE_MAS_VARIABLE');
  assert.equal(state.measurements.height, 1);
  assert.equal(state.calculationBreakdown.missing, 'approvedPrice');
});

test('12. Senal PVC 40x30 cm permite medida pequena', () => {
  const state = nextState(null, 'Senal PVC 40x30 cm', offer('senal-pvc'));

  assert.equal(state.sku, 'senal-pvc');
  assert.equal(state.category, 'SENALIZACION');
  assert.equal(state.measurements.area, 0.12);
  assert.notEqual(state.conversationStatus, 'NEEDS_DIMENSION_CONFIRMATION');
});

test('13. Dos productos en una misma conversacion crean dos items', () => {
  const one = nextState(null, 'Necesito un jala vista 60x60 cm', offer('rotulo-jala-vista'));
  const two = nextState(one, 'Tambien necesito una lona 3x1 m', offer('lona-banner'));

  assert.equal(two.items.length, 2);
  assert.equal(two.items[0].sku, 'rotulo-jala-vista');
  assert.equal(two.items[1].sku, 'lona-banner');
  assert.equal(two.activeItemId, 'item-2');
});

test('14. Cambio de medida actualiza el producto activo', () => {
  const one = nextState(null, 'Lona banner 3x1 m', offer('lona-banner'));
  const two = nextState(one, 'Mejor de 4x1 m', offer('lona-banner'));

  assert.equal(two.activeItemId, 'item-1');
  assert.equal(two.items[0].measurements.area, 4);
});

test('15. Cambio de cantidad actualiza el producto activo', () => {
  const one = nextState(null, 'Jala vista 80x40 cm', offer('rotulo-jala-vista'));
  const two = nextState(one, 'De esa quiero dos', offer('rotulo-jala-vista'));

  assert.equal(two.quantity, 2);
  assert.equal(two.items[0].quantity, 2);
  assert.equal(two.calculatedPrice, 290);
});

test('16. Cambio de producto no mezcla medida anterior', () => {
  const one = nextState(null, 'Jala vista 80x40 cm', offer('rotulo-jala-vista'));
  const two = nextState(one, 'Tambien necesito vinil adhesivo 2x1 m', offer('vinil-adhesivo'));

  assert.equal(two.sku, 'vinil-adhesivo');
  assert.equal(two.measurements.area, 2);
  assert.equal(two.items.find(item => item.sku === 'rotulo-jala-vista').measurements.area, 0.32000000000000006);
});

test('17. Retorno a un producto anterior reactiva su item', () => {
  const one = nextState(null, 'Jala vista 80x40 cm', offer('rotulo-jala-vista'));
  const two = nextState(one, 'Tambien necesito lona 3x1 m', offer('lona-banner'));
  const three = nextState(two, 'Volvamos al jala vista', offer('rotulo-jala-vista'));

  assert.equal(three.sku, 'rotulo-jala-vista');
  assert.equal(three.activeItemId, 'item-1');
  assert.equal(three.measurements.width, 0.8);
});

test('18. Producto sin precio aprobado responde sin fabricar calculo', () => {
  const state = nextState(null, 'Vinil adhesivo 2x1 m', offer('vinil-adhesivo'));
  const correction = buildPricingCorrectionLine({
    commercial: offer('vinil-adhesivo'),
    commercialState: state,
    message: 'Vinil adhesivo 2x1 m'
  });

  assert.equal(state.calculatedPrice, null);
  assert.match(correction.text, /falta definir el precio aprobado/i);
});

test('19. Producto con precio minimo no lo convierte en tarifa', () => {
  const state = nextState(null, 'Fachada PVC 2x1 m', offer('fachada-pvc'));

  assert.equal(state.minimumPrice, 600);
  assert.equal(state.calculatedPrice, null);
  assert.equal(state.calculationBreakdown.missing, 'approvedUnitPriceM2');
});

test('20. Producto con precio fijo y medida estandar responde directo', () => {
  const state = nextState(
    createEmptyCommercialState({ platform: 'ELANVISUAL' }),
    'Rotulo boton 60x60 cm',
    offer('boton-acrilico')
  );
  const correction = buildPricingCorrectionLine({
    commercial: offer('boton-acrilico'),
    commercialState: state,
    message: 'Rotulo boton 60x60 cm'
  });

  assert.equal(state.calculatedPrice, 100);
  assert.match(correction.text, /Precio verificado: USD 100/);
});
