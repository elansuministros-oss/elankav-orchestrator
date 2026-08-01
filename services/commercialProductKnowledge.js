'use strict';

const SOURCE = 'services/commercialProductKnowledge.js';

const FORMULA_TYPES = Object.freeze({
  FIXED_PRICE: 'PRECIO_FIJO',
  FIXED_WITH_BASE_SIZE: 'PRECIO_FIJO_CON_MEDIDA_BASE',
  AREA_M2: 'AREA_M2',
  LINEAR_METER: 'METRO_LINEAL',
  UNIT: 'UNIDAD',
  LETTER_COUNT: 'CANTIDAD_LETRAS',
  LETTER_HEIGHT: 'ALTURA_LETRA',
  PERIMETER: 'PERIMETRO',
  PACKAGE: 'PAQUETE',
  BASE_PLUS_VARIABLE: 'COSTO_BASE_MAS_VARIABLE'
});

const PRODUCT_DEFINITIONS = Object.freeze([
  {
    sku: 'rotulo-jala-vista',
    legacyProductId: 'jalavista-acrilico-doble-cara',
    category: 'ROTULACION',
    subcategory: 'ROTULOS_ESTANDAR',
    productName: 'Rotulo jala vista',
    aliases: ['jala vista', 'ala vista', 'alavista', 'banderola', 'rotulo bandera', 'rotulo doble cara'],
    formulaType: FORMULA_TYPES.FIXED_WITH_BASE_SIZE,
    baseWidth: 0.6,
    baseHeight: 0.6,
    baseAreaM2: 0.36,
    basePrice: 260,
    minimumPrice: 260,
    fixedCost: 260,
    variableCost: 15,
    currency: 'USD',
    includes: ['doble cara', 'medida base 60 x 60 cm'],
    exclusions: ['instalacion', 'cambios no validados'],
    source: SOURCE,
    approved: true,
    effectiveDate: '2026-07-14',
    pricingRule: {
      type: 'dimension-step',
      stepCm: 10,
      incrementUsd: 15,
      roundMode: 'ceil',
      dimensions: ['width', 'height']
    }
  },
  {
    sku: 'boton-acrilico',
    category: 'ROTULACION',
    subcategory: 'ROTULOS_ESTANDAR',
    productName: 'Rotulo boton en acrilico',
    aliases: ['boton', 'rotulo boton', 'redondo', 'circular', 'doble cara redondo', 'rotulo estilo boton'],
    formulaType: FORMULA_TYPES.FIXED_WITH_BASE_SIZE,
    baseWidth: 0.6,
    baseHeight: 0.6,
    baseAreaM2: 0.36,
    basePrice: 100,
    minimumPrice: 100,
    fixedCost: 100,
    currency: 'USD',
    includes: ['acrilico 60 cm'],
    exclusions: ['instalacion', 'acabados premium'],
    source: 'ELANKAV Core commercial_products ECL-001A',
    approved: true,
    effectiveDate: '2026-07-14'
  },
  {
    sku: 'caja-de-luz',
    category: 'ROTULACION',
    subcategory: 'ROTULOS_ESTANDAR',
    productName: 'Caja de luz',
    aliases: ['caja de luz', 'caja luminosa', 'rotulo luminoso', 'letrero con luz'],
    formulaType: FORMULA_TYPES.AREA_M2,
    minimumPrice: null,
    currency: 'USD',
    includes: ['caja luminosa'],
    exclusions: ['instalacion', 'estructura especial'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'totem',
    category: 'ROTULACION',
    subcategory: 'ROTULOS_ESTANDAR',
    productName: 'Totem',
    aliases: ['totem', 'totem publicitario', 'monolito', 'rotulo vertical'],
    formulaType: FORMULA_TYPES.BASE_PLUS_VARIABLE,
    minimumPrice: null,
    currency: 'USD',
    includes: ['estructura pendiente de definir'],
    exclusions: ['obra civil'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'letras-pvc',
    category: 'LETRAS_LOGOTIPOS',
    subcategory: 'LETRAS',
    productName: 'Letras PVC',
    aliases: ['letras pvc', 'letras de pvc', 'letras 3d pvc', 'letras 3d', 'letras volumetricas'],
    formulaType: FORMULA_TYPES.LETTER_COUNT,
    minimumPrice: null,
    currency: 'USD',
    includes: ['letras PVC'],
    exclusions: ['instalacion', 'iluminacion'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'letras-luminosas',
    category: 'LETRAS_LOGOTIPOS',
    subcategory: 'LETRAS',
    productName: 'Letras luminosas',
    aliases: ['letras luminosas', 'letras con luz', 'letras con luz frontal', 'letras con luz de rebote', 'letras de caja'],
    formulaType: FORMULA_TYPES.LETTER_COUNT,
    minimumPrice: null,
    currency: 'USD',
    includes: ['letras iluminadas'],
    exclusions: ['instalacion electrica especial'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'fachada-acm-luz',
    category: 'FACHADAS',
    subcategory: 'ACM',
    productName: 'Fachada ACM',
    aliases: ['fachada acm', 'forrado acm', 'revestimiento acm', 'panel acm', 'fascia acm'],
    formulaType: FORMULA_TYPES.AREA_M2,
    minimumPrice: 1450,
    currency: 'USD',
    includes: ['referencia comercial registrada'],
    exclusions: ['tarifa m2 no aprobada'],
    source: 'ELANKAV Core commercial_products SALES-01D',
    approved: false,
    effectiveDate: '2026-07-14'
  },
  {
    sku: 'fachada-pvc',
    category: 'FACHADAS',
    subcategory: 'PVC',
    productName: 'Fachada PVC',
    aliases: ['fachada pvc', 'fascia pvc', 'revestimiento pvc'],
    formulaType: FORMULA_TYPES.AREA_M2,
    minimumPrice: 600,
    currency: 'USD',
    includes: ['referencia comercial registrada'],
    exclusions: ['tarifa m2 no aprobada'],
    source: 'ELANKAV Core commercial_products SALES-01C',
    approved: false,
    effectiveDate: '2026-07-14'
  },
  {
    sku: 'lona-banner',
    category: 'IMPRESION',
    subcategory: 'LONA',
    productName: 'Lona banner',
    aliases: ['lona', 'banner', 'lona banner', 'manta', 'impresion en lona'],
    formulaType: FORMULA_TYPES.AREA_M2,
    minimumPrice: null,
    currency: 'USD',
    includes: ['impresion en lona'],
    exclusions: ['estructura', 'instalacion'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'vinil-adhesivo',
    category: 'IMPRESION',
    subcategory: 'VINIL',
    productName: 'Vinil adhesivo',
    aliases: ['vinil adhesivo', 'vinyl adhesivo', 'sticker', 'calcomania'],
    formulaType: FORMULA_TYPES.AREA_M2,
    minimumPrice: null,
    currency: 'USD',
    includes: ['impresion en vinil'],
    exclusions: ['instalacion'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'senal-pvc',
    category: 'SENALIZACION',
    subcategory: 'PVC',
    productName: 'Senal PVC',
    aliases: ['senal pvc', 'señal pvc', 'placa pvc', 'senalizacion pvc'],
    formulaType: FORMULA_TYPES.AREA_M2,
    minimumPrice: null,
    currency: 'USD',
    includes: ['senal en PVC'],
    exclusions: ['instalacion'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  },
  {
    sku: 'instalacion',
    category: 'SERVICIOS',
    subcategory: 'INSTALACION',
    productName: 'Instalacion',
    aliases: ['instalacion', 'instalar', 'montaje'],
    formulaType: FORMULA_TYPES.UNIT,
    minimumPrice: null,
    currency: 'USD',
    includes: ['servicio de instalacion'],
    exclusions: ['materiales no incluidos'],
    source: SOURCE,
    approved: false,
    effectiveDate: null
  }
].map(product => Object.freeze({
  pricePerM2: null,
  pricePerLinearMeter: null,
  unitPrice: null,
  quantity: 1,
  variableCost: null,
  fixedCost: null,
  baseWidth: null,
  baseHeight: null,
  baseAreaM2: null,
  basePrice: null,
  minimumPrice: null,
  includes: [],
  exclusions: [],
  ...product,
  aliases: Object.freeze(product.aliases || []),
  includes: Object.freeze(product.includes || []),
  exclusions: Object.freeze(product.exclusions || []),
  pricingRule: product.pricingRule ? Object.freeze(product.pricingRule) : null
})));

const PRODUCT_KNOWLEDGE = Object.freeze(PRODUCT_DEFINITIONS.map(product =>
  Object.freeze({
    productId: product.legacyProductId || product.sku,
    productName: product.productName,
    aliases: product.aliases,
    advertisedPriceUsd: product.basePrice || product.minimumPrice || 0,
    standardDimensions: Object.freeze({
      widthCm: Number(product.baseWidth || 0) * 100,
      heightCm: Number(product.baseHeight || 0) * 100
    }),
    pricingRule: product.pricingRule || null,
    definition: product
  })
));

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function normalizeDimensionUnit(unit) {
  const value = normalize(unit);
  if (/^(mm|milimetros?)$/.test(value)) return 'mm';
  if (/^(m|metros?)$/.test(value)) return 'm';
  return 'cm';
}

function toMeters(value, unit) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return null;
  if (unit === 'mm') return amount / 1000;
  if (unit === 'cm') return amount / 100;
  return amount;
}

function extractDimensions(value) {
  const text = normalize(value).replace(/,/g, '.');
  const match = text.match(
    /\b(\d+(?:\.\d+)?)\s*(mm|milimetros?|cm|centimetros?|m|metros?)?\s*(?:x|\u00d7|por)\s*(\d+(?:\.\d+)?)\s*(mm|milimetros?|cm|centimetros?|m|metros?)?\b/
  );

  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[3]);
  const unit = normalizeDimensionUnit(match[4] || match[2] || 'cm');
  const widthM = toMeters(width, unit);
  const heightM = toMeters(height, unit);

  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    !Number.isFinite(widthM) ||
    !Number.isFinite(heightM)
  ) return null;

  return Object.freeze({
    widthCm: widthM * 100,
    heightCm: heightM * 100,
    widthM,
    heightM,
    areaM2: widthM * heightM,
    unit
  });
}

function extractLetterCount(value) {
  const text = normalize(value);
  const numeric = text.match(/\b(\d+)\s*(?:letras?|caracteres?)\b/);
  if (numeric) return Number(numeric[1]);
  return null;
}

function extractLetterHeight(value) {
  const text = normalize(value).replace(/,/g, '.');
  const match = text.match(/\b(?:de\s*)?(\d+(?:\.\d+)?)\s*(cm|m|mm)?\s*(?:de\s*)?(?:alto|altura)\b/);
  if (!match) return null;
  const unit = normalizeDimensionUnit(match[2] || 'cm');
  return toMeters(Number(match[1]), unit);
}

function isMeasurementQuestion(value) {
  const text = normalize(value);
  return /\b(que|cual|cuanto|cuantos)\b.*\b(medida|tamano|dimension|dimensiones)\b/.test(text) ||
    /\b(medida|tamano|dimension|dimensiones)\b.*\b(tiene|manejan|es)\b/.test(text);
}

function findProductDefinition(input) {
  const text = normalize(
    typeof input === 'string'
      ? input
      : [
          input?.sku,
          input?.productId,
          input?.productName,
          input?.product,
          input?.description,
          input?.message
        ].filter(Boolean).join(' ')
  );
  if (!text) return null;

  return PRODUCT_DEFINITIONS.find(product =>
    text.includes(normalize(product.sku)) ||
    product.aliases.some(alias => text.includes(normalize(alias))) ||
    text.includes(normalize(product.productName))
  ) || null;
}

function calculateDimensionPrice(productKnowledge, requestedDimensions) {
  const product = productKnowledge?.definition || findProductDefinition(productKnowledge);
  if (!product || !requestedDimensions) return null;
  return calculateCommercialPrice(product, {
    measurements: {
      width: requestedDimensions.widthM ?? requestedDimensions.widthCm / 100,
      height: requestedDimensions.heightM ?? requestedDimensions.heightCm / 100,
      area: requestedDimensions.areaM2 ??
        (requestedDimensions.widthCm / 100) * (requestedDimensions.heightCm / 100),
      widthCm: requestedDimensions.widthCm,
      heightCm: requestedDimensions.heightCm
    }
  });
}

function calculateCommercialPrice(product, input = {}) {
  if (!product) return null;
  const measurements = input.measurements || {};
  const quantity = Number(input.quantity || 1);
  const areaM2 = Number(measurements.area || measurements.areaM2 || 0);
  const widthCm = Number(measurements.widthCm || measurements.width * 100 || 0);
  const heightCm = Number(measurements.heightCm || measurements.height * 100 || 0);

  if (!product.approved) {
    return Object.freeze({
      amount: null,
      currency: product.currency,
      formulaType: product.formulaType,
      calculatedPrice: null,
      minimumPrice: product.minimumPrice,
      priceSource: product.source,
      approved: false,
      missing: product.formulaType === FORMULA_TYPES.AREA_M2
        ? 'approvedUnitPriceM2'
        : 'approvedPrice',
      calculationBreakdown: Object.freeze({
        formula: product.formulaType,
        missing: product.formulaType === FORMULA_TYPES.AREA_M2
          ? 'approvedUnitPriceM2'
          : 'approvedPrice',
        measuredAreaM2: areaM2 || null,
        note: 'No approved tariff is available; do not fabricate a calculation.'
      })
    });
  }

  if (product.formulaType === FORMULA_TYPES.FIXED_WITH_BASE_SIZE && product.pricingRule) {
    const baseWidthCm = product.baseWidth * 100;
    const baseHeightCm = product.baseHeight * 100;
    const widthExcess = Math.max(0, widthCm - baseWidthCm);
    const heightExcess = Math.max(0, heightCm - baseHeightCm);
    const widthSteps = Math.ceil(widthExcess / product.pricingRule.stepCm);
    const heightSteps = Math.ceil(heightExcess / product.pricingRule.stepCm);
    const totalSteps = widthSteps + heightSteps;
    const amount = product.minimumPrice + totalSteps * product.pricingRule.incrementUsd;

    return Object.freeze({
      amount,
      currency: product.currency,
      formulaType: 'DIMENSION_STEP',
      baseWidth: product.baseWidth,
      baseHeight: product.baseHeight,
      baseAreaM2: product.baseAreaM2,
      basePrice: product.basePrice,
      minimumPrice: product.minimumPrice,
      calculatedPrice: amount,
      priceSource: product.source,
      approved: true,
      totalSteps,
      widthSteps,
      heightSteps,
      fixedCost: product.fixedCost,
      incrementByMaxDimension: product.pricingRule.incrementUsd,
      rounding: product.pricingRule.roundMode,
      requestedDimensions: {
        widthCm,
        heightCm,
        widthM: widthCm / 100,
        heightM: heightCm / 100,
        areaM2
      },
      standardDimensions: {
        widthCm: baseWidthCm,
        heightCm: baseHeightCm
      },
      calculationBreakdown: Object.freeze({
        rule: product.pricingRule.type,
        standardSizeCm: `${baseWidthCm}x${baseHeightCm}`,
        requestedSizeCm: `${widthCm}x${heightCm}`,
        widthExcessCm: widthExcess,
        heightExcessCm: heightExcess,
        stepCm: product.pricingRule.stepCm,
        widthSteps,
        heightSteps,
        totalSteps,
        formula: `${product.minimumPrice} + (${totalSteps} * ${product.pricingRule.incrementUsd})`,
        note: 'Dimension-step rule: no area discount below the standard dimension; only excess over standard width/height increases price.'
      })
    });
  }

  if (product.formulaType === FORMULA_TYPES.FIXED_WITH_BASE_SIZE) {
    return Object.freeze({
      amount: product.basePrice,
      currency: product.currency,
      formulaType: product.formulaType,
      baseWidth: product.baseWidth,
      baseHeight: product.baseHeight,
      baseAreaM2: product.baseAreaM2,
      basePrice: product.basePrice,
      minimumPrice: product.minimumPrice,
      calculatedPrice: product.basePrice,
      priceSource: product.source,
      approved: true,
      calculationBreakdown: Object.freeze({
        formula: 'approved fixed base-size price',
        standardSizeM: `${product.baseWidth}x${product.baseHeight}`,
        amount: product.basePrice
      })
    });
  }

  if (product.formulaType === FORMULA_TYPES.AREA_M2 && product.pricePerM2) {
    const amount = Math.max(product.minimumPrice || 0, areaM2 * product.pricePerM2) * quantity;
    return Object.freeze({
      amount,
      currency: product.currency,
      formulaType: product.formulaType,
      pricePerM2: product.pricePerM2,
      minimumPrice: product.minimumPrice,
      calculatedPrice: amount,
      priceSource: product.source,
      approved: true,
      calculationBreakdown: Object.freeze({
        formula: `max(${product.minimumPrice || 0}, ${areaM2} * ${product.pricePerM2}) * ${quantity}`,
        areaM2,
        quantity
      })
    });
  }

  return Object.freeze({
    amount: null,
    currency: product.currency,
    formulaType: product.formulaType,
    calculatedPrice: null,
    minimumPrice: product.minimumPrice,
    priceSource: product.source,
    approved: false,
    missing: 'approvedFormulaParameters',
    calculationBreakdown: Object.freeze({
      formula: product.formulaType,
      missing: 'approvedFormulaParameters',
      note: 'Formula exists but required approved parameters are missing.'
    })
  });
}

function resolveProductKnowledge({ message, history, advertisedOffer } = {}) {
  const conversation = [
    ...(Array.isArray(history) ? history.map(item => item?.content || '') : []),
    message || ''
  ].join('\n');
  const advertisedAmount = Number(advertisedOffer?.amount);

  const byAdvertisedAmount = PRODUCT_KNOWLEDGE.find(item =>
    Number.isFinite(advertisedAmount) &&
    advertisedAmount === item.advertisedPriceUsd
  );
  if (byAdvertisedAmount) return byAdvertisedAmount;

  const product = findProductDefinition(conversation);
  if (product) {
    return PRODUCT_KNOWLEDGE.find(item =>
      item.productId === product.legacyProductId ||
      item.productId === product.sku
    ) || null;
  }

  return null;
}

module.exports = {
  FORMULA_TYPES,
  PRODUCT_DEFINITIONS,
  PRODUCT_KNOWLEDGE,
  calculateCommercialPrice,
  calculateDimensionPrice,
  extractDimensions,
  extractLetterCount,
  extractLetterHeight,
  findProductDefinition,
  isMeasurementQuestion,
  normalizeDimensionUnit,
  resolveProductKnowledge
};
