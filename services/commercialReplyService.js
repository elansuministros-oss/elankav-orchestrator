'use strict';

const {
  calculateDimensionPrice,
  extractDimensions,
  isMeasurementQuestion,
  resolveProductKnowledge
} = require('./commercialProductKnowledge');

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hasCommercialPriceIntent(message) {
  return /\b(cotiz|cotizar|cotizacion|precio|cuanto|cuesta|costaria|valor|presupuesto|comprar|informacion)\b/.test(
    normalize(message)
  );
}

function formatAmount(amount) {
  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2
  }).format(Number(amount));
}

function formatOffer(offer) {
  const label = String(offer?.label || 'Opción disponible').trim();
  const amount = Number(offer?.amount);

  if (!Number.isFinite(amount)) return null;

  const prefix = offer?.mode === 'starting-at'
    ? 'desde '
    : offer?.approximate === true
      ? 'aproximadamente '
      : '';

  return `${label}: ${prefix}${offer?.currency || 'USD'} ${formatAmount(amount)}`;
}

function normalizePriceOffers(commercial = {}) {
  if (Array.isArray(commercial.priceOffers)) {
    return commercial.priceOffers
      .filter(offer => Number.isFinite(Number(offer?.amount)))
      .map(offer => ({
        ...offer,
        currency: offer?.currency || commercial.currency || 'USD'
      }))
      .sort((left, right) => Number(left.amount) - Number(right.amount));
  }

  const legacyPrices = commercial.prices;
  if (!legacyPrices || typeof legacyPrices !== 'object' || Array.isArray(legacyPrices)) {
    return [];
  }

  return Object.entries(legacyPrices)
    .map(([key, amount]) => ({
      label: key.charAt(0).toUpperCase() + key.slice(1),
      amount: Number(amount),
      currency: commercial.currency || 'USD'
    }))
    .filter(offer => Number.isFinite(offer.amount))
    .sort((left, right) => left.amount - right.amount);
}

function extractUsdAmounts(value) {
  const text = String(value || '');
  const matches = text.matchAll(/\bUSD\s*([0-9]+(?:[.,][0-9]{1,2})?)/gi);

  return [...matches]
    .map(match => Number(String(match[1]).replace(',', '.')))
    .filter(Number.isFinite);
}

function isAdvertisedOfferMessage(value) {
  const text = normalize(value);
  if (!text || !extractUsdAmounts(value).length) return false;

  return (
    /anuncio|modelo|publicad|promocion/.test(text) &&
    /rotulo|acrilico|boton|letra|fachada|producto/.test(text)
  );
}

function buildHistoryEntries(history) {
  return Array.isArray(history)
    ? history
        .slice(-12)
        .map(item => ({
          role: String(item?.role || '').toLowerCase(),
          content: String(item?.content || '').trim()
        }))
        .filter(item => item.content)
    : [];
}

function resolveAdvertisedContext({ history } = {}) {
  const advertisedEntry = [...buildHistoryEntries(history)]
    .reverse()
    .find(item =>
      ['assistant', 'system'].includes(item.role) &&
      isAdvertisedOfferMessage(item.content)
    );

  if (!advertisedEntry) return null;

  const [amount] = extractUsdAmounts(advertisedEntry.content);
  if (!Number.isFinite(amount)) return null;

  return Object.freeze({
    amount,
    currency: 'USD',
    sourceText: advertisedEntry.content
  });
}

function resolveAdvertisedOffer({ message, history } = {}) {
  const advertisedContext = resolveAdvertisedContext({ history });
  if (!advertisedContext) return null;

  const entries = buildHistoryEntries(history);
  const currentAndUserHistory = [
    ...entries
      .filter(item => item.role === 'user')
      .map(item => item.content),
    String(message || '')
  ].join('\n');
  const referencedAmounts = extractUsdAmounts(currentAndUserHistory);

  return referencedAmounts.includes(advertisedContext.amount)
    ? advertisedContext
    : null;
}

function buildAdvertisedOfferReply(offer) {
  return [
    `¡Claro! El modelo anunciado mantiene el precio publicado de USD ${formatAmount(offer.amount)} en la configuración mostrada en el anuncio.`,
    '',
    'Si lo querés igual al anuncio, cotizamos sobre ese valor. Cualquier cambio de medida, acabado, iluminación o instalación se confirma aparte.',
    '',
    '¿Lo querés igual al modelo anunciado o necesitás algún cambio?'
  ].join('\n');
}

function buildStandardMeasurementReply(product) {
  const { widthCm, heightCm } = product.standardDimensions;

  return [
    `El modelo anunciado mide ${formatAmount(widthCm)} × ${formatAmount(heightCm)} cm y tiene un valor de USD ${formatAmount(product.advertisedPriceUsd)}.`,
    '',
    '¿Lo necesitás en esa medida o en otra?'
  ].join('\n');
}

function buildRequestedMeasurementReply(product, dimensions) {
  const pricing = calculateDimensionPrice(product, dimensions);
  if (!pricing) return null;

  const { widthCm, heightCm } = dimensions;

  return [
    `Para la medida de ${formatAmount(widthCm)} × ${formatAmount(heightCm)} cm, el valor es de USD ${formatAmount(pricing.amount)}.`,
    '',
    '¿Sería para interior o exterior?'
  ].join('\n');
}

function extractCentimeterMeasurement(message) {
  const match = normalize(message).match(
    /\b(\d+(?:[.,]\d+)?)\s*(?:cm|centimetros?)\b/
  );

  if (!match) return null;

  const measurement = Number(match[1].replace(',', '.'));
  return Number.isFinite(measurement) ? measurement : null;
}

function qualificationWasAnswered(question, conversationText) {
  const normalizedQuestion = normalize(question);
  const normalizedConversation = normalize(conversationText);

  if (!normalizedQuestion || !normalizedConversation) return false;

  if (
    /interior|exterior/.test(normalizedQuestion) &&
    /\b(interior|exterior)\b/.test(normalizedConversation)
  ) {
    return true;
  }

  if (
    /logo/.test(normalizedQuestion) &&
    /\b(logo|sin logo|no tengo logo)\b/.test(normalizedConversation)
  ) {
    return true;
  }

  if (
    /ancho|alto|medida|tamano/.test(normalizedQuestion) &&
    /\b\d+(?:[.,]\d+)?\s*(?:cm|m|metro|metros)\b/.test(normalizedConversation)
  ) {
    return true;
  }

  return false;
}

function buildConversationText(message, history) {
  const previousUserMessages = Array.isArray(history)
    ? history
        .filter(item => item?.role === 'user')
        .slice(-6)
        .map(item => String(item.content || '').trim())
        .filter(Boolean)
    : [];

  return [...previousUserMessages, String(message || '').trim()]
    .filter(Boolean)
    .join('\n');
}

function buildSalesOpening(commercial) {
  const productName = String(commercial?.productName || 'este producto').trim();
  return `¡Claro! Te ayudamos con la cotización de ${productName}.`;
}

function buildValueStatement(commercial) {
  const explicit = String(
    commercial?.salesGuidance?.valueStatement || ''
  ).trim();

  if (explicit) return explicit;

  return 'Trabajamos cada proyecto según medida, material, acabado e instalación para que el resultado sea profesional y durable.';
}

function buildVerifiedCommercialReply({
  message,
  history,
  commercial
} = {}) {
  if (!commercial?.available) return null;

  const priceOffers = normalizePriceOffers(commercial);

  if (!priceOffers.length) return null;

  const firstReply = String(
    commercial.salesGuidance?.firstReply || ''
  ).trim();
  let reply;

  if (firstReply) {
    reply = firstReply;
  } else {
    const offers = priceOffers
      .slice(0, 2)
      .map(formatOffer)
      .filter(Boolean);

    reply = `${buildSalesOpening(commercial)}\n\n${offers.join('\n')}`;
  }

  const standardCm = Number(
    commercial.specifications?.baseCm ||
    commercial.specifications?.baseWidthCm ||
    0
  );
  const requestedCm = extractCentimeterMeasurement(message);

  if (
    requestedCm &&
    standardCm &&
    requestedCm !== standardCm
  ) {
    reply += `\n\nLa medida estándar publicada es de ${formatAmount(standardCm)} cm; la medida de ${formatAmount(requestedCm)} cm debe confirmarse antes de cerrar la cotización.`;
  }

  const valueStatement = buildValueStatement(commercial);
  if (valueStatement && !normalize(reply).includes(normalize(valueStatement))) {
    reply += `\n\n${valueStatement}`;
  }

  const qualificationQuestion = String(
    commercial.salesGuidance?.qualificationQuestion || ''
  ).trim();
  const conversationText = buildConversationText(message, history);

  if (
    qualificationQuestion &&
    !qualificationWasAnswered(qualificationQuestion, conversationText)
  ) {
    reply += `\n\n${qualificationQuestion}`;
  }

  return reply;
}

function applyVerifiedCommercialReply({
  message,
  history,
  commercial,
  response
} = {}) {
  const advertisedContext = resolveAdvertisedContext({ history });
  const productKnowledge = resolveProductKnowledge({
    message,
    history,
    advertisedOffer: advertisedContext
  });
  const requestedDimensions = extractDimensions(message);

  if (productKnowledge && isMeasurementQuestion(message)) {
    return {
      ...response,
      outputText: buildStandardMeasurementReply(productKnowledge),
      model: 'elankav-commercial-knowledge',
      commercialAction: true,
      commercialSource: 'product-knowledge'
    };
  }

  if (productKnowledge && requestedDimensions) {
    return {
      ...response,
      outputText: buildRequestedMeasurementReply(productKnowledge, requestedDimensions),
      model: 'elankav-commercial-knowledge',
      commercialAction: true,
      commercialSource: 'product-knowledge'
    };
  }

  if (!hasCommercialPriceIntent(message)) {
    return response;
  }

  const advertisedOffer = resolveAdvertisedOffer({ message, history });
  if (advertisedOffer) {
    return {
      ...response,
      outputText: buildAdvertisedOfferReply(advertisedOffer),
      model: 'elankav-commercial-ad-verified',
      commercialAction: true,
      commercialSource: 'advertisement'
    };
  }

  if (!commercial?.available) {
    return response;
  }

  const outputText = buildVerifiedCommercialReply({
    message,
    history,
    commercial
  });

  if (!outputText) return response;

  return {
    ...response,
    outputText,
    model: 'elankav-commercial-verified',
    commercialAction: true
  };
}

module.exports = {
  applyVerifiedCommercialReply,
  buildAdvertisedOfferReply,
  buildRequestedMeasurementReply,
  buildSalesOpening,
  buildStandardMeasurementReply,
  buildValueStatement,
  buildVerifiedCommercialReply,
  extractCentimeterMeasurement,
  extractUsdAmounts,
  formatOffer,
  hasCommercialPriceIntent,
  normalizePriceOffers,
  qualificationWasAnswered,
  resolveAdvertisedContext,
  resolveAdvertisedOffer
};