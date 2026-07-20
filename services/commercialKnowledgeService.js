'use strict';

const { listActiveProducts } = require('../adapters/commercialKnowledgeSupabaseAdapter');

const FALLBACK_PRODUCTS = Object.freeze([
  Object.freeze({
    platformId: 'ELANVISUAL',
    productId: 'JALAVISTA_DOBLE',
    productCode: 'JALAVISTA_DOBLE',
    productName: 'Rótulo jala vista doble cara en acrílico',
    aliases: Object.freeze([
      'jala vista',
      'jalavista',
      'doble cara',
      'rotulo acrilico de anuncio',
      'rotulo acrilico estilo boton'
    ]),
    advertisedPriceUsd: 260,
    standardDimensions: Object.freeze({ widthCm: 60, heightCm: 60 }),
    pricingRule: Object.freeze({
      type: 'dimension-step',
      stepCm: 10,
      incrementUsd: 15,
      minimumPriceUsd: 260,
      roundMode: 'ceil',
      dimensions: Object.freeze(['width', 'height'])
    }),
    materials: Object.freeze(['acrílico']),
    finishes: Object.freeze([]),
    lighting: Object.freeze([]),
    faq: Object.freeze([]),
    active: true,
    source: 'fallback'
  })
]);

let cache = FALLBACK_PRODUCTS;
let state = Object.freeze({ source: 'fallback', loadedAt: null, error: null });

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function firstFinite(...values) {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return 0;
}

function mapRow(row = {}) {
  const specifications = asObject(row.specifications);
  const dimensions = asObject(specifications.standardDimensions || specifications.standard_dimensions);
  const priceOffers = asObject(row.price_offers);
  const advertisedOffer = asObject(priceOffers.advertised || priceOffers.base || priceOffers.standard);
  const commercialRules = asObject(row.commercial_rules);
  const pricingRule = asObject(commercialRules.pricingRule || commercialRules.pricing_rule || commercialRules.pricing);
  const salesGuidance = asObject(row.sales_guidance);

  const status = normalize(row.status);
  const productId = String(row.product_id || row.product_code || row.id || '');
  const productName = String(row.name || row.product_name || '');

  return Object.freeze({
    platformId: String(row.platform_id || '').toUpperCase(),
    productId,
    productCode: String(row.product_code || row.product_id || ''),
    productName,
    aliases: Object.freeze(asArray(row.aliases)),
    advertisedPriceUsd: firstFinite(
      row.advertised_price_usd,
      advertisedOffer.amount,
      advertisedOffer.priceUsd,
      priceOffers.advertisedPriceUsd
    ),
    standardDimensions: Object.freeze({
      widthCm: firstFinite(row.standard_width_cm, dimensions.widthCm, specifications.standardWidthCm),
      heightCm: firstFinite(row.standard_height_cm, dimensions.heightCm, specifications.standardHeightCm)
    }),
    pricingRule: Object.freeze(
      Object.keys(pricingRule).length ? pricingRule : asObject(row.pricing_rules)
    ),
    materials: Object.freeze(asArray(row.materials).length ? asArray(row.materials) : asArray(specifications.materials)),
    finishes: Object.freeze(asArray(row.finishes).length ? asArray(row.finishes) : asArray(specifications.finishes)),
    lighting: Object.freeze(asArray(row.lighting).length ? asArray(row.lighting) : asArray(specifications.lighting)),
    faq: Object.freeze(asArray(row.faq).length ? asArray(row.faq) : asArray(salesGuidance.faq)),
    productionTime: row.production_time || salesGuidance.productionTime || null,
    installation: row.installation || salesGuidance.installation || null,
    warranty: row.warranty || salesGuidance.warranty || null,
    active: row.active !== false && !['archived', 'inactive', 'disabled'].includes(status),
    source: 'supabase'
  });
}

async function refreshCommercialKnowledge({ platformId } = {}) {
  try {
    const rows = await listActiveProducts({ platformId });
    const mapped = rows.map(mapRow).filter(product => product.productId && product.productName && product.active);
    if (!mapped.length) throw Object.assign(new Error('COMMERCIAL_KNOWLEDGE_EMPTY'), { code: 'COMMERCIAL_KNOWLEDGE_EMPTY' });
    cache = mapped;
    state = Object.freeze({
      source: 'supabase',
      loadedAt: new Date().toISOString(),
      error: null
    });
  } catch (error) {
    cache = FALLBACK_PRODUCTS;
    state = Object.freeze({
      source: 'fallback',
      loadedAt: new Date().toISOString(),
      error: error?.code || 'COMMERCIAL_KNOWLEDGE_LOAD_FAILED'
    });
  }

  return getCommercialKnowledgeState();
}

function getCommercialKnowledgeState() {
  return Object.freeze({ ...state, products: cache.length });
}

function getProducts() {
  return cache.slice();
}

function findProduct({ message, query, history, advertisedOffer, platformId = 'ELANVISUAL' } = {}) {
  const conversation = [
    ...(Array.isArray(history) ? history.map(item => item?.content || '') : []),
    query || message || ''
  ].join('\n');
  const text = normalize(conversation);
  const advertisedAmount = Number(advertisedOffer?.amount);
  const platform = String(platformId || '').toUpperCase();

  return cache.find(product => {
    if (platform && product.platformId && product.platformId !== platform) return false;
    if (Number.isFinite(advertisedAmount) && advertisedAmount === product.advertisedPriceUsd) return true;
    if (normalize(product.productCode) && text.includes(normalize(product.productCode))) return true;
    return product.aliases.some(alias => text.includes(normalize(alias)));
  }) || null;
}

function findFAQ(product, question) {
  if (!product || !Array.isArray(product.faq)) return null;
  const text = normalize(question);
  return product.faq.find(item => {
    const patterns = Array.isArray(item?.patterns) ? item.patterns : [];
    return patterns.some(pattern => text.includes(normalize(pattern)));
  }) || null;
}

function calculateCommercialPrice(product, requestedDimensions) {
  if (!product || !requestedDimensions) return null;
  const base = product.standardDimensions;
  const rule = product.pricingRule;
  if (rule?.type !== 'dimension-step') return null;

  const widthExcess = Math.max(0, requestedDimensions.widthCm - base.widthCm);
  const heightExcess = Math.max(0, requestedDimensions.heightCm - base.heightCm);
  const widthSteps = Math.ceil(widthExcess / Number(rule.stepCm));
  const heightSteps = Math.ceil(heightExcess / Number(rule.stepCm));
  const totalSteps = widthSteps + heightSteps;
  const amount = Number(rule.minimumPriceUsd) + totalSteps * Number(rule.incrementUsd);

  return Object.freeze({
    amount,
    currency: 'USD',
    totalSteps,
    widthSteps,
    heightSteps,
    requestedDimensions,
    standardDimensions: base
  });
}

function findMeasurements(product) {
  return product?.standardDimensions || null;
}

function findMaterial(product, query) {
  const text = normalize(query);
  return product?.materials?.find(item => normalize(item).includes(text) || text.includes(normalize(item))) || null;
}

function findLighting(product, query) {
  const text = normalize(query);
  return product?.lighting?.find(item => normalize(item).includes(text) || text.includes(normalize(item))) || null;
}

function findFinish(product, query) {
  const text = normalize(query);
  return product?.finishes?.find(item => normalize(item).includes(text) || text.includes(normalize(item))) || null;
}

module.exports = {
  FALLBACK_PRODUCTS,
  calculateCommercialPrice,
  findFAQ,
  findFinish,
  findLighting,
  findMaterial,
  findMeasurements,
  findProduct,
  getCommercialKnowledgeState,
  getProducts,
  mapRow,
  refreshCommercialKnowledge
};