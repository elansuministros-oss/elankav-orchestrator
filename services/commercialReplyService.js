'use strict';

const {
  calculateCommercialPrice,
  calculateDimensionPrice,
  extractDimensions,
  findProductDefinition,
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

  const priceOffers = Array.isArray(commercial.priceOffers)
    ? commercial.priceOffers
        .filter(offer => Number.isFinite(Number(offer?.amount)))
        .sort((left, right) => Number(left.amount) - Number(right.amount))
    : [];

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

function responseIncludesAmount(responseText, amount) {
  const normalizedAmount = formatAmount(amount)
    .replace(/,/g, '')
    .replace(/\.00$/, '');
  const escaped = normalizedAmount.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${escaped}(?:\\.00)?\\b`).test(
    String(responseText || '').replace(/,/g, '')
  );
}

function buildPricingCorrectionLine({ commercial, commercialState, message } = {}) {
  const validation = commercialState?.calculationBreakdown?.physicalValidation;
  if (validation?.status === 'ATYPICAL_DIMENSION') {
    return {
      amount: null,
      replace: true,
      text: validation.question
    };
  }

  if (commercialState?.calculationBreakdown?.missing === 'approvedUnitPriceM2') {
    const reference = commercialState.calculationBreakdown.registeredReferencePrice;
    const currency = commercialState.calculationBreakdown.currency || 'USD';
    const area = commercialState.calculationBreakdown.measuredAreaM2;
    const parts = [
      'Se cotiza por metro cuadrado, pero falta definir el precio aprobado por metro cuadrado para calcular esta medida.'
    ];

    if (Number.isFinite(Number(reference))) {
      parts.push(`Referencia registrada: desde ${currency} ${formatAmount(reference)}.`);
    }
    if (Number.isFinite(Number(area))) {
      parts.push(`Area detectada: ${formatAmount(area)} m2.`);
    }

    return {
      amount: null,
      forceAppend: true,
      text: parts.join(' ')
    };
  }

  if (commercialState?.calculationBreakdown?.missing === 'approvedOfficialTariff') {
    const formulaType = commercialState.calculationBreakdown.formulaType;
    const sourceDocument = commercialState.calculationBreakdown.sourceDocument;
    const parts = [
      'Tenemos el producto registrado, pero falta una tarifa oficial aprobada para calcularlo.'
    ];

    if (formulaType) parts.push(`Formula esperada: ${formulaType}.`);
    if (sourceDocument) parts.push(`Fuente registrada: ${sourceDocument}.`);
    parts.push('Para avanzar, confirmame la medida indispensable y lo validamos con la tabla oficial.');

    return {
      amount: null,
      forceAppend: true,
      text: parts.join(' ')
    };
  }

  const statePrice = commercialState?.verifiedPrice;
  const requestedDimensions =
    commercialState?.measurements?.width && commercialState?.measurements?.height
      ? {
          widthCm: commercialState.measurements.unit === 'm'
            ? commercialState.measurements.width * 100
            : commercialState.measurements.width,
          heightCm: commercialState.measurements.unit === 'm'
            ? commercialState.measurements.height * 100
            : commercialState.measurements.height
        }
      : extractDimensions(message);
  const productDefinition = findProductDefinition({
    sku: commercialState?.sku || commercial?.productId,
    productId: commercial?.productId || commercialState?.sku,
    productName: commercialState?.product || commercial?.productName,
    description: commercial?.description,
    message
  });
  const dimensionPricing = productDefinition
    ? calculateCommercialPrice(productDefinition, {
        measurements: commercialState?.measurements?.width
          ? commercialState.measurements
          : requestedDimensions
            ? {
                width: requestedDimensions.widthM,
                height: requestedDimensions.heightM,
                area: requestedDimensions.areaM2,
                widthCm: requestedDimensions.widthCm,
                heightCm: requestedDimensions.heightCm
              }
            : null,
        quantity: commercialState?.quantity || 1
      })
    : null;
  const price = dimensionPricing
    ? dimensionPricing.amount
      ? {
        amount: dimensionPricing.amount,
        currency: dimensionPricing.currency || 'USD',
        mode: 'reference',
        formula: dimensionPricing.formulaType,
        breakdown: dimensionPricing.calculationBreakdown
      }
      : null
    : statePrice;

  if (!price || !Number.isFinite(Number(price.amount))) return null;

  const formula = price.formula || commercialState?.formula || null;
  const prefix = price.mode === 'starting-at'
    ? 'desde '
    : price.approximate === true
      ? 'aproximadamente '
      : '';
  const quantity = Number(commercialState?.quantity || 1);
  const total = Number.isFinite(quantity) && quantity > 1
    ? Number(price.amount) * quantity
    : null;
  const parts = [
    `Precio verificado: ${prefix}${price.currency || 'USD'} ${formatAmount(price.amount)}.`
  ];

  if (total) {
    parts.push(`Cantidad: ${quantity}. Total: ${price.currency || 'USD'} ${formatAmount(total)}.`);
  }

  if (formula) {
    parts.push(`Formula comercial: ${formula}.`);
  }

  const breakdown = price.breakdown || commercialState?.calculationBreakdown;
  if (breakdown?.formula) {
    parts.push(`Detalle: ${breakdown.formula}.`);
  }

  return {
    amount: Number(price.amount),
    text: parts.join(' ')
  };
}

function applyPricingOnlyCommercialCorrection({
  message,
  commercial,
  commercialState,
  response
} = {}) {
  if (!commercialState?.sku && !commercialState?.product) return null;

  const correction = buildPricingCorrectionLine({
    commercial,
    commercialState,
    message
  });

  if (!correction) {
    return {
      ...response,
      commercialState
    };
  }

  const outputText = String(response?.outputText || '').trim();
  if (correction.replace) {
    return {
      ...response,
      outputText: correction.text,
      model: 'elankav-commercial-dimension-validation',
      commercialAction: true,
      commercialSource: 'persistent-commercial-state',
      commercialState
    };
  }

  if (!correction.forceAppend && responseIncludesAmount(outputText, correction.amount)) {
    return {
      ...response,
      commercialState,
      commercialAction: response?.commercialAction || true
    };
  }

  return {
    ...response,
    outputText: [outputText, correction.text].filter(Boolean).join('\n\n'),
    model: response?.model || 'elankav-commercial-pricing-verified',
    commercialAction: true,
    commercialSource: 'persistent-commercial-state',
    commercialState
  };
}

function applyVerifiedCommercialReply({
  message,
  history,
  commercialState,
  commercial,
  response
} = {}) {
  const pricingOnly = applyPricingOnlyCommercialCorrection({
    message,
    commercial,
    commercialState,
    response
  });

  if (pricingOnly) return pricingOnly;

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
    commercialAction: true,
    commercialState: commercialState || null
  };
}

module.exports = {
  applyVerifiedCommercialReply,
  applyPricingOnlyCommercialCorrection,
  buildAdvertisedOfferReply,
  buildPricingCorrectionLine,
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
