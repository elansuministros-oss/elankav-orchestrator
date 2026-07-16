'use strict';

const PRODUCT_KNOWLEDGE = Object.freeze([
  Object.freeze({
    productId: 'jalavista-acrilico-doble-cara',
    productName: 'Rótulo jala vista doble cara en acrílico',
    aliases: Object.freeze([
      'jala vista',
      'jalavista',
      'doble cara',
      'rotulo acrilico de anuncio',
      'rotulo acrilico estilo boton'
    ]),
    advertisedPriceUsd: 260,
    standardDimensions: Object.freeze({
      widthCm: 60,
      heightCm: 60
    }),
    pricingRule: Object.freeze({
      type: 'dimension-step',
      stepCm: 10,
      incrementUsd: 15,
      minimumPriceUsd: 260,
      roundMode: 'ceil',
      dimensions: Object.freeze(['width', 'height'])
    })
  })
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function extractDimensions(value) {
  const text = normalize(value).replace(/,/g, '.');
  const match = text.match(
    /\b(\d+(?:\.\d+)?)\s*(?:x|×|por)\s*(\d+(?:\.\d+)?)\s*(?:cm|centimetros?)?\b/
  );

  if (!match) return null;

  const widthCm = Number(match[1]);
  const heightCm = Number(match[2]);

  if (!Number.isFinite(widthCm) || !Number.isFinite(heightCm)) return null;

  return Object.freeze({ widthCm, heightCm });
}

function isMeasurementQuestion(value) {
  const text = normalize(value);
  return /\b(que|cual|cuanto|cuantos)\b.*\b(medida|tamano|dimension|dimensiones)\b/.test(text) ||
    /\b(medida|tamano|dimension|dimensiones)\b.*\b(tiene|manejan|es)\b/.test(text);
}

function calculateDimensionPrice(product, requestedDimensions) {
  if (!product || !requestedDimensions) return null;

  const base = product.standardDimensions;
  const rule = product.pricingRule;
  const widthExcess = Math.max(0, requestedDimensions.widthCm - base.widthCm);
  const heightExcess = Math.max(0, requestedDimensions.heightCm - base.heightCm);
  const widthSteps = Math.ceil(widthExcess / rule.stepCm);
  const heightSteps = Math.ceil(heightExcess / rule.stepCm);
  const totalSteps = widthSteps + heightSteps;
  const amount = rule.minimumPriceUsd + totalSteps * rule.incrementUsd;

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

function resolveProductKnowledge({ message, history, advertisedOffer } = {}) {
  const conversation = [
    ...(Array.isArray(history) ? history.map(item => item?.content || '') : []),
    message || ''
  ].join('\n');
  const normalizedConversation = normalize(conversation);
  const advertisedAmount = Number(advertisedOffer?.amount);

  return PRODUCT_KNOWLEDGE.find(product => {
    if (
      Number.isFinite(advertisedAmount) &&
      advertisedAmount === product.advertisedPriceUsd
    ) {
      return true;
    }

    return product.aliases.some(alias => normalizedConversation.includes(normalize(alias)));
  }) || null;
}

module.exports = {
  PRODUCT_KNOWLEDGE,
  calculateDimensionPrice,
  extractDimensions,
  isMeasurementQuestion,
  resolveProductKnowledge
};
