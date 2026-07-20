'use strict';

const {
  calculateCommercialPrice,
  findProduct,
  getProducts,
  refreshCommercialKnowledge
} = require('./commercialKnowledgeService');

void refreshCommercialKnowledge({ platformId: 'ELANVISUAL' });

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
  return calculateCommercialPrice(product, requestedDimensions);
}

function resolveProductKnowledge({ message, history, advertisedOffer, platformId } = {}) {
  return findProduct({ message, history, advertisedOffer, platformId });
}

module.exports = {
  PRODUCT_KNOWLEDGE: getProducts(),
  calculateDimensionPrice,
  extractDimensions,
  isMeasurementQuestion,
  resolveProductKnowledge
};
