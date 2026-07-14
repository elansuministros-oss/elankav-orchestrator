'use strict';

const {
  fetchCommercialOffer
} = require('../adapters/commercialLibraryAdapter');

const PRODUCT_ID = 'boton-acrilico';

const VARIANT_ALIASES = Object.freeze([
  Object.freeze({
    id: 'boton-impresion-uv-premium',
    pattern: /\b(uv|impresion uv)\b/
  }),
  Object.freeze({
    id: 'boton-premium-combinado',
    pattern: /\b(combinado|combinada|relieve|capas)\b/
  }),
  Object.freeze({
    id: 'boton-con-impresion',
    pattern: /\b(con impresion|impresion|impreso|full color)\b/
  }),
  Object.freeze({
    id: 'boton-transparente',
    pattern: /\b(transparente|sin impresion)\b/
  })
]);

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function recentHistoryText(history = []) {
  if (!Array.isArray(history)) return '';

  return history
    .slice(-4)
    .map(item => normalizeText(item?.content))
    .filter(Boolean)
    .join(' ');
}

function hasButtonMention(value) {
  const text = normalizeText(value);

  return (
    /\brotulo (?:de )?(?:acrilico )?(?:(?:estilo|tipo) )?boton\b/.test(text) ||
    /\bboton (?:de )?acrilico\b/.test(text) ||
    /\bboton publicitario\b/.test(text) ||
    /\bboton luminoso\b/.test(text)
  );
}

function hasPricingIntent(text) {
  return /\b(precio|cuesta|coste|valor|cotizar|cotizacion|presupuesto|cuanto)\b/.test(text);
}

function hasPaymentIntent(text) {
  return /\b(anticipo|pago|pagar|saldo|abono|cuenta bancaria)\b/.test(text);
}

function hasSpecificationIntent(text) {
  return /\b(material|acrilico|grosor|espesor|medida|tamano|interior|exterior)\b/.test(text);
}

function hasDesignOnlyIntent(text) {
  const design = /\b(disena|disename|crear?me|genera|render|muestra|muestrame|visualiza)\b/.test(text);

  return (
    design &&
    !hasPricingIntent(text) &&
    !hasPaymentIntent(text) &&
    !hasSpecificationIntent(text)
  );
}

function detectButtonCommercialIntent({ message, history } = {}) {
  const text = normalizeText(message);
  const historyText = recentHistoryText(history);
  const currentMention = hasButtonMention(text);
  const contextualMention = hasButtonMention(historyText);
  const commercialSignal =
    hasPricingIntent(text) ||
    hasPaymentIntent(text) ||
    hasSpecificationIntent(text) ||
    /\b(me interesa|quiero|necesito|informacion|info)\b/.test(text);

  if (/\bjala vista\b/.test(text)) {
    return {
      detected: false,
      reason: 'DIFFERENT_PRODUCT_JALA_VISTA'
    };
  }

  if (hasDesignOnlyIntent(text)) {
    return {
      detected: false,
      reason: 'DESIGN_INTENT_HAS_PRIORITY'
    };
  }

  const detected =
    currentMention ||
    (contextualMention && commercialSignal);

  return {
    detected,
    currentMention,
    contextualMention,
    pricingIntent: hasPricingIntent(text),
    paymentIntent: hasPaymentIntent(text),
    specificationIntent: hasSpecificationIntent(text),
    exterior: /\b(exterior|calle|intemperie)\b/.test(text),
    interior: /\binterior|adentro\b/.test(text)
  };
}

function extractSize(value) {
  const text = normalizeText(value);
  const dimensions = text.match(
    /\b(\d{2,3}(?:[.,]\d+)?)\s*(?:x|por)\s*(\d{2,3}(?:[.,]\d+)?)\s*(?:cm|centimetros?)?\b/
  );

  if (dimensions) {
    const width = Number(dimensions[1].replace(',', '.'));
    const height = Number(dimensions[2].replace(',', '.'));

    return {
      sizeCm: width,
      widthCm: width,
      heightCm: height,
      nonSquare: width !== height
    };
  }

  const single = text.match(
    /\b(\d{2,3}(?:[.,]\d+)?)\s*(?:cm|centimetros?)\b/
  );

  if (!single) {
    return {
      sizeCm: null,
      widthCm: null,
      heightCm: null,
      nonSquare: false
    };
  }

  const sizeCm = Number(single[1].replace(',', '.'));

  return {
    sizeCm,
    widthCm: sizeCm,
    heightCm: sizeCm,
    nonSquare: false
  };
}

function detectVariantId(value) {
  const text = normalizeText(value);
  const match = VARIANT_ALIASES.find(item => item.pattern.test(text));
  return match?.id || null;
}

function formatUsd(value) {
  return `USD ${Number(value).toFixed(0)}`;
}

function paymentText(offer) {
  const advance = Number(
    offer?.commercialRules?.paymentAdvancePercent
  );
  const balance = Number(
    offer?.commercialRules?.paymentBalancePercent
  );

  if (!Number.isFinite(advance) || !Number.isFinite(balance)) {
    return '';
  }

  return `Trabajamos con ${advance}% de anticipo y ${balance}% de saldo.`;
}

function materialText(offer) {
  const thickness = Number(offer?.materialRules?.thicknessMm);
  const base = Number(offer?.dimensions?.baseCm);
  const max = Number(offer?.dimensions?.maxStandardCm);

  return `Se fabrica en acrílico transparente de ${thickness} mm. La medida base es ${base} × ${base} cm y el máximo estándar es ${max} × ${max} cm.`;
}

function buildManualReviewReply({ size, offer, exterior }) {
  if (size.nonSquare) {
    return 'El rótulo estilo botón estándar utiliza proporción 1:1. Esa medida rectangular necesita revisión manual antes de confirmar precio.';
  }

  if (exterior) {
    return `La configuración estándar del botón es para interior. Para exterior necesitamos validar materiales e instalación antes de confirmar el precio. ${paymentText(offer)}`.trim();
  }

  return `La medida de ${size.sizeCm} cm requiere revisión manual porque las medidas estándar avanzan cada 10 cm entre 60 y 120 cm. No te daré un precio sin validarlo.`;
}

function buildOfferReply({ offer, variantId, size, intent }) {
  if (size.nonSquare || intent.exterior) {
    return buildManualReviewReply({
      size,
      offer,
      exterior: intent.exterior
    });
  }

  const manualReview = offer.variants.some(
    item => item.quote.status === 'manual-review'
  );

  if (manualReview) {
    return buildManualReviewReply({ size, offer, exterior: false });
  }

  if (
    intent.paymentIntent &&
    !intent.pricingIntent &&
    !intent.specificationIntent
  ) {
    return paymentText(offer);
  }

  if (
    intent.specificationIntent &&
    !intent.pricingIntent &&
    !variantId &&
    size.sizeCm === null
  ) {
    return `${materialText(offer)} ${paymentText(offer)}`;
  }

  const selected = variantId
    ? offer.variants.find(item => item.id === variantId)
    : null;
  const effectiveSize = Number(offer.effectiveSizeCm);
  const sizeLabel = `${effectiveSize} × ${effectiveSize} cm`;

  if (selected) {
    const question = intent.interior
      ? ''
      : ' ¿Lo instalarás en interior?';

    return `${selected.name} de ${sizeLabel}: ${formatUsd(selected.quote.total)}. ${paymentText(offer)}${question}`.trim();
  }

  const priceLines = offer.variants
    .map(item => `• ${item.name}: ${formatUsd(item.quote.total)}`)
    .join('\n');
  const intro = offer.baseSizeUsed
    ? `Precios oficiales del rótulo estilo botón en medida base ${sizeLabel}:`
    : `Precios oficiales del rótulo estilo botón de ${sizeLabel}:`;

  return [
    intro,
    priceLines,
    `Cada 10 cm adicionales suma ${formatUsd(offer.pricingRule.incrementAmount)}, hasta 120 cm.`,
    paymentText(offer),
    '¿Cuál acabado te interesa?'
  ].filter(Boolean).join('\n');
}

async function processButtonCommercialConversation(
  { message, history } = {},
  dependencies = {}
) {
  const intent = detectButtonCommercialIntent({ message, history });

  if (!intent.detected) {
    return {
      handled: false,
      detection: intent
    };
  }

  const size = extractSize(message);
  const variantId = detectVariantId(message);
  const loadOffer =
    dependencies.fetchCommercialOffer ||
    fetchCommercialOffer;
  const response = await loadOffer(
    {
      productId: PRODUCT_ID,
      sizeCm: size.sizeCm
    },
    dependencies.adapterOptions || {}
  );

  if (!response?.ok || !response.offer) {
    return {
      handled: true,
      completed: false,
      status:
        response?.status ||
        'COMMERCIAL_LIBRARY_UNAVAILABLE',
      outputText:
        'Necesito verificar el cotizador oficial antes de confirmarte el precio. Puedo seguir ayudándote con la medida y el acabado mientras lo revisamos.',
      productId: PRODUCT_ID,
      variantId,
      sizeCm: size.sizeCm
    };
  }

  return {
    handled: true,
    completed: true,
    status: 'COMMERCIAL_RESPONSE_READY',
    outputText: buildOfferReply({
      offer: response.offer,
      variantId,
      size,
      intent
    }),
    productId: PRODUCT_ID,
    productVersion: response.offer.productVersion || null,
    variantId,
    sizeCm: size.sizeCm,
    source: response.offer.source
  };
}

module.exports = {
  PRODUCT_ID,
  buildOfferReply,
  detectButtonCommercialIntent,
  detectVariantId,
  extractSize,
  processButtonCommercialConversation
};
