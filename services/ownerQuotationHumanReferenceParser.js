'use strict';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function stripHonorific(value) {
  return String(value || '')
    .replace(/^(?:la|el)\s+/i, '')
    .replace(/^(?:dra\.?|dr\.?|sra\.?|sr\.?|arq\.?)\s+/i, '')
    .trim();
}

function parseDimensionsWithUnit(message) {
  const match = String(message || '').match(
    /\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|cms|centimetros|centímetros|m|mts|metros)?(?=\s|[.,;]|$)/i
  );
  if (!match) return {};

  let width = Number(match[1].replace(',', '.'));
  let height = Number(match[2].replace(',', '.'));
  const unit = normalize(match[3] || 'm');

  if (/^(cm|cms|centimetro|centimetros)$/.test(unit)) {
    width /= 100;
    height /= 100;
  }

  return { width, height, original: match[0].trim() };
}

function parseCustomerReference(message) {
  const raw = String(message || '');
  const patterns = [
    /\bcotizaci[oó]n\s+(?:de|para)\s+(.+?)(?=\s+(?:y|despu[eé]s|donde|que|para|luego)(?=\s|[,. ;]|$)|[,.;]|$)/i,
    /\bcliente\s+(.+?)(?=\s+(?:y|despu[eé]s|donde|que|para|luego)(?=\s|[,. ;]|$)|[,.;]|$)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return stripHonorific(match[1]);
  }

  return '';
}

const ADD_VERB_SOURCE = 'agrega|agregar|agregá|añade|anade|incluye|incorpora|pone|poné';

function parseAnchorReference(message) {
  const raw = String(message || '');
  const addLookahead = `(?=\\s+(?:${ADD_VERB_SOURCE})(?=\\s|[,;:.]|$)|[,.;]|$)`;
  const patterns = [
    new RegExp(`\\bdespu[eé]s\\s+(?:del|de\\s+la|de)\\s+(?:item|ítem)?\\s*(?:del|de\\s+la|de)?\\s*(.+?)${addLookahead}`, 'i'),
    new RegExp(`\\bdebajo\\s+(?:del|de\\s+la|de)\\s+(?:item|ítem)?\\s*(?:del|de\\s+la|de)?\\s*(.+?)${addLookahead}`, 'i')
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1].trim();
  }

  return '';
}

function cleanProductText(value) {
  return String(value || '')
    .replace(/^(?:como\s+)?(?:un|una|el|la)\s+nuevo\s+(?:item|ítem)\s*[:\-]?\s*/i, '')
    .replace(/^(?:un|una|el|la)\s+/i, '')
    .replace(/\s+(?:como\s+)?(?:un\s+)?nuevo\s+(?:item|ítem)\s*$/i, '')
    .replace(/[.;,]+$/g, '')
    .trim();
}

function findAddVerbs(raw) {
  const regex = new RegExp(`(?:^|[\\s,;:])(${ADD_VERB_SOURCE})(?=\\s|[,;:.]|$)`, 'gi');
  return [...String(raw || '').matchAll(regex)].map(match => {
    const verb = match[1];
    const offset = match[0].lastIndexOf(verb);
    return {
      verb,
      index: match.index + offset,
      end: match.index + offset + verb.length
    };
  });
}

function parseAddQuotationItemRequest(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw).replace(/^elan[\s,;:]+/, '');

  if (!/\bcotizacion\b/.test(text)) return null;
  if (/\b(imagen|foto|fotografia)\b/.test(text)) return null;

  const addMatches = findAddVerbs(raw);
  if (!addMatches.length) return null;

  const selected = addMatches[addMatches.length - 1];
  let tail = raw.slice(selected.end).trim();

  tail = tail.replace(/^a\s+(?:esta|la)\s+cotizaci[oó]n\s+/i, '');
  tail = tail.replace(/^(?:como\s+)?(?:un|una)\s+nuevo\s+(?:item|ítem)\s*[:\-]?\s*/i, '');
  tail = tail.replace(/\b(?:busca|buscá|buscar|toma|tomá|usa|usá)\s+(?:el\s+)?precio(?=\s|[,;:.]|$)[\s\S]*$/i, '');
  tail = tail.replace(/\by\s+agregalo\s+como\s+(?:un\s+)?nuevo\s+(?:item|ítem)(?=\s|[,;:.]|$)[\s\S]*$/i, '');

  const requestedDescription = cleanProductText(tail);
  if (!requestedDescription || /^(?:el|la)?\s*(?:nuevo\s+)?(?:item|ítem)$/i.test(requestedDescription)) {
    return null;
  }

  const dimensions = parseDimensionsWithUnit(requestedDescription);
  const productQuery = cleanProductText(
    requestedDescription
      .replace(/\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:cm|cms|centimetros|centímetros|m|mts|metros)?(?=\s|[.,;]|$)/gi, '')
      .replace(/\bde\s*$/i, '')
      .replace(/\s+/g, ' ')
  );

  return {
    customerReference: parseCustomerReference(raw),
    anchorReference: parseAnchorReference(raw),
    requestedDescription,
    productQuery,
    width: dimensions.width,
    height: dimensions.height,
    quantity: 1
  };
}

module.exports = {
  cleanProductText,
  findAddVerbs,
  parseAddQuotationItemRequest,
  parseAnchorReference,
  parseCustomerReference,
  parseDimensionsWithUnit
};
