'use strict';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function hasCommercialPriceIntent(message) {
  return /\b(cotiz|cotizar|cotizacion|precio|cuanto|cuesta|costaria|valor|presupuesto)\b/.test(
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

    reply = `Para ${commercial.productName}, estas son las opciones verificadas: ${offers.join('; ')}.`;
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
    reply += ` La medida estándar publicada es de ${formatAmount(standardCm)} cm; la medida de ${formatAmount(requestedCm)} cm debe confirmarse antes de cerrar la cotización.`;
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
  if (
    !hasCommercialPriceIntent(message) ||
    !commercial?.available
  ) {
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
  buildVerifiedCommercialReply,
  extractCentimeterMeasurement,
  formatOffer,
  hasCommercialPriceIntent,
  qualificationWasAnswered
};
