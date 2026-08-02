'use strict';

const {
  calculateDimensionPrice,
  extractDimensions,
  isMeasurementQuestion,
  resolveProductKnowledge
} = require('./commercialProductKnowledge');

const OFFICIAL_SITE_URL = 'https://visual.elankav.com/';
const DEFAULT_DESIGN_CTA = 'Si ya tenés el diseño o logotipo, mandámelo por aquí. Si todavía no lo tenés, nosotros podemos prepararlo.';
const DEFAULT_SITE_CTA = `También podés conocer nuestros trabajos y servicios en ${OFFICIAL_SITE_URL}`;

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

function extractUsdAmounts(value) {
  const matches = String(value || '').matchAll(/\bUSD\s*([0-9]+(?:[.,][0-9]{1,2})?)/gi);
  return [...matches]
    .map(match => Number(String(match[1]).replace(',', '.')))
    .filter(Number.isFinite);
}

function isAdvertisedOfferMessage(value) {
  const text = normalize(value);
  return Boolean(
    text &&
    extractUsdAmounts(value).length &&
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

  const referencedAmounts = extractUsdAmounts([
    ...buildHistoryEntries(history)
      .filter(item => item.role === 'user')
      .map(item => item.content),
    String(message || '')
  ].join('\n'));

  return referencedAmounts.includes(advertisedContext.amount)
    ? advertisedContext
    : null;
}

function resolveSalesGuidance(entity) {
  return entity?.salesGuidance || {};
}

function appendUniqueParagraph(lines, paragraph) {
  const value = String(paragraph || '').trim();
  if (!value) return;

  const current = normalize(lines.join('\n'));
  if (!current.includes(normalize(value))) {
    lines.push('', value);
  }
}

function buildGlobalSalesCta(entity, { includeNextQuestion = true } = {}) {
  const guidance = resolveSalesGuidance(entity);
  const lines = [];

  appendUniqueParagraph(
    lines,
    guidance.designCta || DEFAULT_DESIGN_CTA
  );
  appendUniqueParagraph(
    lines,
    guidance.websiteCta || DEFAULT_SITE_CTA
  );

  if (includeNextQuestion) {
    appendUniqueParagraph(
      lines,
      guidance.nextQuestion || guidance.qualificationQuestion
    );
  }

  return lines.join('\n').trim();
}

function appendGlobalSalesCta(reply, entity, options) {
  const lines = [String(reply || '').trim()];
  const cta = buildGlobalSalesCta(entity, options);
  appendUniqueParagraph(lines, cta);
  return lines.filter(Boolean).join('\n\n');
}

function buildAdvertisedOfferReply(offer) {
  const reply = [
    `¡Claro! El modelo anunciado mantiene el precio publicado de USD ${formatAmount(offer.amount)} en la configuración mostrada en el anuncio.`,
    '',
    'Si lo querés igual al anuncio, cotizamos sobre ese valor. Cualquier cambio de medida, acabado, iluminación o instalación se confirma aparte.'
  ].join('\n');

  return appendGlobalSalesCta(reply, null, { includeNextQuestion: false });
}

function buildStandardMeasurementReply(product) {
  const { widthCm, heightCm } = product.standardDimensions;
  const reply = `El modelo anunciado mide ${formatAmount(widthCm)} × ${formatAmount(heightCm)} cm y tiene un valor de USD ${formatAmount(product.advertisedPriceUsd)}.`;
  return appendGlobalSalesCta(reply, product);
}

function buildRequestedMeasurementReply(product, dimensions) {
  const pricing = calculateDimensionPrice(product, dimensions);
  if (!pricing) return null;

  const { widthCm, heightCm } = dimensions;
  const lines = [
    `El ${String(product.productName || 'producto').toLowerCase()} de ${formatAmount(widthCm)} × ${formatAmount(heightCm)} cm tiene un valor de USD ${formatAmount(pricing.amount)}.`
  ];

  appendUniqueParagraph(lines, product?.salesGuidance?.valueStatement);
  return appendGlobalSalesCta(lines.join('\n'), product);
}

function buildProductContinuationReply({ message, product } = {}) {
  if (!product) return null;

  const normalizedMessage = normalize(message);
  const expectedEnvironment = normalize(
    product?.commercialRules?.defaultEnvironment
  );

  if (expectedEnvironment && normalizedMessage === expectedEnvironment) {
    const reply = `Correcto, el ${String(product.productName || 'producto').toLowerCase()} está diseñado para ${expectedEnvironment}.`;
    return appendGlobalSalesCta(reply, product);
  }

  return null;
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
  ) return true;

  if (
    /logo|diseno/.test(normalizedQuestion) &&
    /\b(logo|diseno|sin logo|no tengo logo|no tengo diseno)\b/.test(normalizedConversation)
  ) return true;

  if (
    /ancho|alto|medida|tamano/.test(normalizedQuestion) &&
    /\b\d+(?:[.,]\d+)?\s*(?:cm|m|metro|metros)\b/.test(normalizedConversation)
  ) return true;

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

function buildVerifiedCommercialReply({ message, history, commercial } = {}) {
  if (!commercial?.available) return null;

  const priceOffers = Array.isArray(commercial.priceOffers)
    ? commercial.priceOffers
        .filter(offer => Number.isFinite(Number(offer?.amount)))
        .sort((left, right) => Number(left.amount) - Number(right.amount))
    : [];
  if (!priceOffers.length) return null;

  const firstReply = String(commercial.salesGuidance?.firstReply || '').trim();
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

  if (requestedCm && standardCm && requestedCm !== standardCm) {
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
  const includeNextQuestion = !qualificationQuestion ||
    !qualificationWasAnswered(qualificationQuestion, conversationText);

  return appendGlobalSalesCta(reply, commercial, { includeNextQuestion });
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

  const continuationReply = buildProductContinuationReply({
    message,
    product: productKnowledge
  });

  if (continuationReply) {
    return {
      ...response,
      outputText: continuationReply,
      model: 'elankav-commercial-continuation',
      commercialAction: true,
      commercialSource: 'product-knowledge'
    };
  }

  if (!hasCommercialPriceIntent(message)) return response;

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

  if (!commercial?.available) return response;

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
  DEFAULT_DESIGN_CTA,
  DEFAULT_SITE_CTA,
  OFFICIAL_SITE_URL,
  applyVerifiedCommercialReply,
  appendGlobalSalesCta,
  buildAdvertisedOfferReply,
  buildGlobalSalesCta,
  buildProductContinuationReply,
  buildRequestedMeasurementReply,
  buildSalesOpening,
  buildStandardMeasurementReply,
  buildValueStatement,
  buildVerifiedCommercialReply,
  extractCentimeterMeasurement,
  extractUsdAmounts,
  formatOffer,
  hasCommercialPriceIntent,
  qualificationWasAnswered,
  resolveAdvertisedContext,
  resolveAdvertisedOffer
};
