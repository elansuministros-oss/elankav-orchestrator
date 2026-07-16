'use strict';

const { listActiveProducts } = require('../adapters/commercialKnowledgeSupabaseAdapter');

const FALLBACK_PRODUCTS = Object.freeze([
  Object.freeze({
    platformId: 'ELANVISUAL',
    productId: 'jalavista-acrilico-doble-cara',
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
    active: true
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

function mapRow(row = {}) {
  return Object.freeze({
    platformId: String(row.platform_id || '').toUpperCase(),
    productId: String(row.product_code || row.id || ''),
    productCode: String(row.product_code || ''),
    productName: String(row.product_name || ''),
    aliases: Object.freeze(Array.isArray(row.aliases) ? row.aliases : []),
    advertisedPriceUsd: Number(row.advertised_price_usd),
    standardDimensions: Object.freeze({
      widthCm: Number(row.standard_width_cm),
      heightCm: Number(row.standard_height_cm)
    }),
    pricingRule: Object.freeze(row.pricing_rules || {}),
    materials: Object.freeze(Array.isArray(row.materials) ? row.materials : []),
    finishes: Object.freeze(Array.isArray(row.finishes) ? row.finishes : []),
    lighting: Object.freeze(Array.isArray(row.lighting) ? row.lighting : []),
    faq: Object.freeze(Array.isArray(row.faq) ? row.faq : []),
    productionTime: row.production_time || null,
    installation: row.installation || null,
    warranty: row.warranty || null,
    active: row.active !== false
  });
}

async function refreshCommercialKnowledge({ platformId } = {}) {
  try {
    const rows = await listActiveProducts({ platformId });
    cache = rows.map(mapRow).filter(product => product.productId && product.productName);
    state = Object.freeze({
      source: 'supabase',
      loadedAt: new Date().toISOString(),
      error: null
    });
  } catch (error) {
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

function findProduct({ message, history, advertisedOffer, platformId = 'ELANVISUAL' } = {}) {
  const conversation = [
    ...(Array.isArray(history) ? history.map(item => item?.content || '') : []),
    message || ''
  ].join('\n');
  const text = normalize(conversation);
  const advertisedAmount = Number(advertisedOffer?.amount);
  const platform = String(platformId || '').toUpperCase();

  return cache.find(product => {
    if (platform && product.platformId && product.platformId !== platform) return false;
    if (Number.isFinite(advertisedAmount) && advertisedAmount === product.advertisedPriceUsd) return true;
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
