'use strict';

const {
  fetchCommercialOffer
} = require('../adapters/commercialLibraryAdapter');
const {
  loadPlatformKnowledgeSafely,
  normalizePlatform
} = require('./connectPlatformKnowledgeService');
const {
  calculateCommercialPrice,
  extractDimensions,
  extractLetterCount,
  extractLetterHeight,
  findProductDefinition,
  resolveProductKnowledge
} = require('./commercialProductKnowledge');
const {
  createCommercialStateRepository
} = require('./commercialStateRepository');

const MAX_COMMERCIAL_HISTORY_MESSAGES = 4;
const DEFAULT_COMMERCIAL_PLATFORM = 'ELANVISUAL';
const commercialStateStore = new Map();
let commercialStateRepository = createCommercialStateRepository();

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSearchText(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveCommercialConversationKey({
  platform,
  channel,
  externalUserId,
  phone,
  metadata
} = {}) {
  const identity = normalizeText(
    externalUserId ||
    phone ||
    metadata?.externalUserId ||
    metadata?.phone ||
    metadata?.conversationRef ||
    metadata?.requestId ||
    'anonymous'
  ).toLowerCase();
  const resolvedPlatform = resolveKnowledgePlatform(platform || DEFAULT_COMMERCIAL_PLATFORM);
  const resolvedChannel = normalizeText(channel || metadata?.channel || 'whatsapp')
    .toLowerCase() || 'whatsapp';

  return `${resolvedPlatform}:${resolvedChannel}:${identity}`;
}

function createEmptyCommercialState({
  platform,
  status = 'INICIADO'
} = {}) {
  return Object.freeze({
    platform: resolveKnowledgePlatform(platform || DEFAULT_COMMERCIAL_PLATFORM),
    activeItemId: null,
    items: Object.freeze([]),
    category: null,
    product: null,
    sku: null,
    intent: null,
    measurements: Object.freeze({
      width: null,
      height: null,
      unit: null,
      sourceUnit: null,
      sourceWidth: null,
      sourceHeight: null,
      widthCm: null,
      heightCm: null,
      area: null
    }),
    quantity: null,
    finishes: Object.freeze([]),
    environment: null,
    letterCount: null,
    letterHeight: null,
    formula: null,
    formulaType: null,
    baseWidth: null,
    baseHeight: null,
    baseAreaM2: null,
    basePrice: null,
    minimumPrice: null,
    calculatedPrice: null,
    calculationBreakdown: null,
    priceSource: null,
    verifiedPrice: null,
    productHistory: Object.freeze([]),
    conversationStatus: status,
    documentUsed: null,
    updatedAt: null
  });
}

function cloneCommercialState(state) {
  return {
    ...createEmptyCommercialState({ platform: state?.platform }),
    ...(state && typeof state === 'object' ? state : {}),
    items: Array.isArray(state?.items)
      ? state.items.map(item => ({
          ...item,
          measurements: item?.measurements ? { ...item.measurements } : null,
          finishes: Array.isArray(item?.finishes) ? [...item.finishes] : [],
          verifiedPrice: item?.verifiedPrice ? { ...item.verifiedPrice } : null,
          calculationBreakdown: item?.calculationBreakdown ? { ...item.calculationBreakdown } : null
        }))
      : [],
    measurements: {
      width: state?.measurements?.width ?? null,
      height: state?.measurements?.height ?? null,
      unit: state?.measurements?.unit ?? null,
      sourceUnit: state?.measurements?.sourceUnit ?? null,
      sourceWidth: state?.measurements?.sourceWidth ?? null,
      sourceHeight: state?.measurements?.sourceHeight ?? null,
      widthCm: state?.measurements?.widthCm ?? null,
      heightCm: state?.measurements?.heightCm ?? null,
      area: state?.measurements?.area ?? null
    },
    finishes: Array.isArray(state?.finishes) ? [...state.finishes] : [],
    letterCount: state?.letterCount ?? null,
    letterHeight: state?.letterHeight ?? null,
    verifiedPrice: state?.verifiedPrice ? { ...state.verifiedPrice } : null,
    calculationBreakdown: state?.calculationBreakdown
      ? { ...state.calculationBreakdown }
      : null,
    productHistory: Array.isArray(state?.productHistory)
      ? [...state.productHistory]
      : []
  };
}

function getPersistentCommercialState(keyOrInput) {
  const key = typeof keyOrInput === 'string'
    ? keyOrInput
    : resolveCommercialConversationKey(keyOrInput);

  const state = commercialStateStore.get(key);
  return state ? Object.freeze(cloneCommercialState(state)) : null;
}

async function loadPersistentCommercialState(keyOrInput) {
  const key = typeof keyOrInput === 'string'
    ? keyOrInput
    : resolveCommercialConversationKey(keyOrInput);
  const cached = getPersistentCommercialState(key);
  if (cached) return cached;

  const state = await commercialStateRepository.get(key);
  if (!state) return null;
  const normalized = Object.freeze(cloneCommercialState(state));
  commercialStateStore.set(key, normalized);
  return normalized;
}

async function savePersistentCommercialState(keyOrInput, state, identity = {}) {
  const key = typeof keyOrInput === 'string'
    ? keyOrInput
    : resolveCommercialConversationKey(keyOrInput);
  const normalized = Object.freeze({
    ...cloneCommercialState(state),
    updatedAt: state?.updatedAt || new Date().toISOString()
  });

  commercialStateStore.set(key, normalized);
  await commercialStateRepository.save(key, normalized, identity);
  return normalized;
}

async function clearPersistentCommercialState(keyOrInput) {
  const key = typeof keyOrInput === 'string'
    ? keyOrInput
    : resolveCommercialConversationKey(keyOrInput);
  commercialStateStore.delete(key);
  await commercialStateRepository.clear(key);
}

function setCommercialStateRepositoryForTests(repository) {
  commercialStateRepository = repository || createCommercialStateRepository();
  commercialStateStore.clear();
}

function detectCommercialIntent(message) {
  const text = normalizeSearchText(message);
  if (/\b(cotiz|cotizar|cotizacion|precio|cuanto|cuesta|valor|presupuesto|comprar)\b/.test(text)) {
    return 'COTIZAR';
  }
  if (/\b(necesito|quiero|busco|me interesa|ocupo)\b/.test(text)) {
    return 'INTERES';
  }
  return null;
}

function detectCategory({ message, commercial } = {}) {
  const product = findProductDefinition({
    sku: commercial?.productId,
    productId: commercial?.productId,
    productName: commercial?.productName,
    description: commercial?.description,
    message
  });
  if (product?.category) return product.category;

  const text = normalizeSearchText([
    message,
    commercial?.productName,
    commercial?.description
  ].filter(Boolean).join(' '));

  if (/\b(rotulo|rotulacion|fachada|fascia|acm|pvc|letra|banner|jala|cajuela)\b/.test(text)) {
    return 'ROTULACION';
  }
  return null;
}

function detectEnvironment(message) {
  const text = normalizeSearchText(message);
  if (/\b(interior|interno|adentro)\b/.test(text)) return 'INTERIOR';
  if (/\b(exterior|externo|afuera|intemperie)\b/.test(text)) return 'EXTERIOR';
  return null;
}

function detectFinishes(message) {
  const text = normalizeSearchText(message);
  const finishes = [];
  if (/\b(luz|iluminad|luminos)\b/.test(text)) finishes.push('LUZ');
  if (/\b(acrilico|acrilica)\b/.test(text)) finishes.push('ACRILICO');
  if (/\b(pvc)\b/.test(text)) finishes.push('PVC');
  if (/\b(acm)\b/.test(text)) finishes.push('ACM');
  if (/\b(uv|impresion)\b/.test(text)) finishes.push('IMPRESION');
  if (/\b(ojete|ojetes)\b/.test(text)) finishes.push('OJETES');
  return finishes;
}

function detectQuantity(message) {
  const text = normalizeSearchText(message);
  if (extractDimensions(message)) {
    return null;
  }

  const numeric = text.match(/\b(\d+)\s*(?:unidades?|unds?|piezas?)?\b/);
  if (numeric) return normalizeNumber(numeric[1]);

  const words = {
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10
  };
  const found = Object.entries(words).find(([word]) =>
    new RegExp(`\\b${word}\\b`).test(text)
  );
  return found ? found[1] : null;
}

function detectMeasurements(message) {
  const pair = extractDimensions(message);
  if (pair) {
    return {
      width: pair.widthM,
      height: pair.heightM,
      unit: 'm',
      sourceUnit: pair.unit,
      sourceWidth: pair.unit === 'm'
        ? pair.widthM
        : pair.unit === 'mm'
          ? pair.widthM * 1000
          : pair.widthCm,
      sourceHeight: pair.unit === 'm'
        ? pair.heightM
        : pair.unit === 'mm'
          ? pair.heightM * 1000
          : pair.heightCm,
      area: pair.areaM2,
      widthCm: pair.widthCm,
      heightCm: pair.heightCm
    };
  }

  const text = normalizeSearchText(message).replace(/,/g, '.');
  const area = text.match(/\b(\d+(?:\.\d+)?)\s*(?:m2|m\^2|metros?\s*cuadrados?)\b/);
  if (area) {
    return {
      width: null,
      height: null,
      unit: 'm',
      sourceUnit: 'm2',
      area: normalizeNumber(area[1])
    };
  }

  return null;
}

function inferCommercialFormula({ commercial, state } = {}) {
  const product = findProductDefinition({
    sku: state?.sku,
    productId: commercial?.productId,
    productName: commercial?.productName || state?.product,
    description: commercial?.description
  });
  if (product?.formulaType) return product.formulaType;
  return state?.formula || null;
}

function resolveVerifiedPrice(commercial) {
  if (commercial?.priceSource && commercial.priceSource.approved === false) {
    return null;
  }

  const offers = Array.isArray(commercial?.priceOffers)
    ? commercial.priceOffers
        .filter(offer => Number.isFinite(Number(offer?.amount)))
        .sort((left, right) => Number(left.amount) - Number(right.amount))
    : [];

  const [offer] = offers;
  if (!offer) return null;

  return {
    amount: Number(offer.amount),
    currency: offer.currency || 'USD',
    mode: offer.mode || 'reference',
    approximate: offer.approximate === true,
    label: offer.label || null,
    source: commercial?.source || 'ELANKAV Commercial Library'
  };
}

function resolveProductDefinition({ commercial, state, message } = {}) {
  return findProductDefinition({
    sku: state?.sku || commercial?.productId,
    productId: commercial?.productId || state?.sku,
    productName: commercial?.productName || state?.product,
    product: state?.product,
    description: commercial?.description,
    message
  }) || (commercial?.productId || commercial?.productName
    ? {
        sku: commercial.productId || state?.sku,
        productName: commercial.productName || state?.product,
        category: commercial.category || state?.category,
        formulaType: commercial.formulaType || commercial.commercialRules?.formulaType || state?.formulaType,
        source: commercial.priceSource?.source || commercial.source,
        baseWidth: commercial.calculation?.baseWidth ?? commercial.commercialRules?.baseWidth ?? null,
        baseHeight: commercial.calculation?.baseHeight ?? commercial.commercialRules?.baseHeight ?? null,
        baseAreaM2: commercial.calculation?.baseAreaM2 ?? commercial.commercialRules?.baseAreaM2 ?? null,
        basePrice: commercial.calculation?.basePrice ?? commercial.commercialRules?.basePrice ?? null,
        pricePerM2: commercial.calculation?.pricePerM2 ?? commercial.commercialRules?.pricePerM2 ?? null,
        pricePerLinearMeter: commercial.calculation?.pricePerLinearMeter ?? commercial.commercialRules?.pricePerLinearMeter ?? null,
        unitPrice: commercial.calculation?.unitPrice ?? commercial.commercialRules?.unitPrice ?? null,
        minimumPrice: commercial.calculation?.minimumPrice ?? commercial.commercialRules?.minimumPrice ?? null,
        fixedCost: commercial.calculation?.fixedCost ?? commercial.commercialRules?.fixedCost ?? null,
        variableCost: commercial.calculation?.variableCost ?? commercial.commercialRules?.variableCost ?? null,
        currency: commercial.priceOffers?.[0]?.currency || commercial.currency || 'USD'
      }
    : null);
}

function validatePhysicalDimensions({ commercial, state } = {}) {
  const measurements = state?.measurements;
  const product = resolveProductDefinition({ commercial, state });
  if (!measurements?.area) return null;

  if (product?.category === 'FACHADAS' && measurements.sourceUnit === 'cm') {
    return {
      status: 'ATYPICAL_DIMENSION',
      question: 'Confirmas que la fachada mide 60 x 40 centimetros, o te referis a 6 x 4 metros?',
      reason: 'Familia FACHADAS con dimensiones en centimetros requiere confirmacion de unidad antes de calcular.'
    };
  }

  return null;
}

function applyCalculationDetails({ state, commercial } = {}) {
  const next = state;
  const product = resolveProductDefinition({ commercial, state: next });
  const price = resolveVerifiedPrice(commercial) || next.verifiedPrice;

  if (product) {
    if (commercial?.priceSource?.approved === false) {
      next.category = product.category || next.category;
      next.product = product.productName || next.product;
      next.sku = product.sku || next.sku;
      next.formula = product.formulaType || next.formula;
      next.formulaType = product.formulaType || next.formulaType || null;
      next.priceSource = commercial.priceSource.source || product.source || null;
      next.calculationBreakdown = {
        missing: 'approvedOfficialTariff',
        priceSourceStatus: commercial.priceSource.status,
        sourceDocument: commercial.priceSource.source,
        formulaType: next.formulaType
      };
      next.verifiedPrice = null;
      next.calculatedPrice = null;
      return next;
    }

    const hasMeasurements = Boolean(next.measurements?.width || next.measurements?.height);
    const pricing = calculateCommercialPrice(product, {
      measurements: hasMeasurements
        ? next.measurements
        : product.baseWidth && product.baseHeight
          ? {
              width: product.baseWidth,
              height: product.baseHeight,
              area: product.baseAreaM2,
              widthCm: product.baseWidth * 100,
              heightCm: product.baseHeight * 100
            }
          : next.measurements,
      quantity: next.quantity || 1
    });

    next.category = product.category || next.category;
    next.product = product.productName || next.product;
    next.sku = product.sku || next.sku;
    next.formula = product.formulaType || next.formula;
    next.formulaType = pricing?.formulaType || product.formulaType || null;
    next.baseWidth = pricing?.baseWidth ?? product.baseWidth ?? null;
    next.baseHeight = pricing?.baseHeight ?? product.baseHeight ?? null;
    next.baseAreaM2 = pricing?.baseAreaM2 ?? product.baseAreaM2 ?? null;
    next.basePrice = pricing?.basePrice ?? product.basePrice ?? price?.amount ?? null;
    next.minimumPrice = pricing?.minimumPrice ?? product.minimumPrice ?? null;
    next.calculatedPrice = pricing?.calculatedPrice ?? null;
    next.priceSource = pricing?.priceSource || product.source || price?.source || null;
    next.calculationBreakdown = pricing?.calculationBreakdown || null;
    if (pricing?.amount) {
      next.verifiedPrice = {
        amount: pricing.amount,
        currency: pricing.currency,
        mode: 'reference',
        approximate: hasMeasurements,
        label: product.productName,
        source: pricing.priceSource
      };
    } else if (price && !next.verifiedPrice) {
      next.verifiedPrice = price;
    }
    return next;
  }

  if (price) {
    next.formulaType = next.formula || 'PRECIO_FIJO';
    next.basePrice = price.amount;
    next.minimumPrice = price.mode === 'starting-at' ? price.amount : null;
    next.calculatedPrice = price.amount;
    next.priceSource = price.source;
    next.calculationBreakdown = {
      formula: 'registered fixed/reference price',
      amount: price.amount,
      currency: price.currency,
      mode: price.mode
    };
  }

  return next;
}

function isLocalFallbackEnabled() {
  return String(process.env.COMMERCIAL_LOCAL_FALLBACK_ENABLED || '')
    .trim()
    .toLowerCase() === 'true';
}

function buildLocalFallbackOffer({ message, commercialState, lookupText, error } = {}) {
  if (!isLocalFallbackEnabled()) return null;
  const product = findProductDefinition({
    sku: commercialState?.sku,
    productId: commercialState?.sku,
    productName: commercialState?.product,
    product: commercialState?.product,
    message: lookupText || message
  }) || resolveProductKnowledge({ message: lookupText || message });

  if (!product) return null;

  console.warn('[COMMERCIAL_FALLBACK_USED]', {
    reason: error?.code || error?.message || 'COMMERCIAL_LIBRARY_NO_RESPONSE',
    sku: product.sku || product.productId || null,
    product: product.productName || product.name || null
  });

  return {
    available: true,
    source: 'commercialProductKnowledge fallback',
    productId: product.sku || product.productId,
    productName: product.productName || product.name,
    description: product.description || null,
    category: product.category || null,
    specifications: {
      baseWidth: product.baseWidth || null,
      baseHeight: product.baseHeight || null,
      baseAreaM2: product.baseAreaM2 || null
    },
    priceOffers: Number.isFinite(Number(product.basePrice))
      ? [{
          amount: product.basePrice,
          currency: product.currency || 'USD',
          mode: product.formulaType || 'PRECIO_FIJO',
          approximate: false
        }]
      : [],
    salesGuidance: product.salesGuidance || {},
    commercialRules: product,
    formulaType: product.formulaType || null,
    calculation: {
      formulaType: product.formulaType || null,
      basePrice: product.basePrice || null,
      baseWidth: product.baseWidth || null,
      baseHeight: product.baseHeight || null,
      baseAreaM2: product.baseAreaM2 || null,
      pricePerM2: product.pricePerM2 || null,
      pricePerLinearMeter: product.pricePerLinearMeter || null,
      unitPrice: product.unitPrice || null,
      minimumPrice: product.minimumPrice || null,
      fixedCost: product.fixedCost || null,
      variableCost: product.variableCost || null
    },
    priceSource: {
      source: product.source || 'commercialProductKnowledge fallback',
      approved: true,
      status: 'LOCAL_FALLBACK'
    },
    fallbackUsed: true
  };
}

function buildCommercialStateItem(state) {
  const id = state.activeItemId ||
    `item-${Math.max(1, Array.isArray(state.items) ? state.items.length + 1 : 1)}`;
  return {
    id,
    category: state.category,
    subcategory: state.subcategory || null,
    product: state.product,
    sku: state.sku,
    measurements: { ...(state.measurements || {}) },
    quantity: state.quantity,
    finishes: Array.isArray(state.finishes) ? [...state.finishes] : [],
    environment: state.environment,
    letterCount: state.letterCount,
    letterHeight: state.letterHeight,
    formulaType: state.formulaType || state.formula,
    baseWidth: state.baseWidth,
    baseHeight: state.baseHeight,
    baseAreaM2: state.baseAreaM2,
    basePrice: state.basePrice,
    minimumPrice: state.minimumPrice,
    calculatedPrice: state.calculatedPrice,
    calculationBreakdown: state.calculationBreakdown,
    priceSource: state.priceSource,
    verifiedPrice: state.verifiedPrice,
    status: state.conversationStatus || 'COTIZANDO'
  };
}

function syncActiveCommercialItem(state) {
  if (!state?.sku && !state?.product) return state;
  const next = state;
  const items = Array.isArray(next.items) ? [...next.items] : [];
  const activeId = next.activeItemId || `item-${items.length + 1}`;
  const activeItem = buildCommercialStateItem({
    ...next,
    activeItemId: activeId,
    items
  });
  const existingIndex = items.findIndex(item => item.id === activeId);

  if (existingIndex >= 0) {
    items[existingIndex] = activeItem;
  } else {
    items.push(activeItem);
  }

  next.activeItemId = activeId;
  next.items = items;
  return next;
}

function restoreCommercialItem(state, item) {
  if (!item) return state;
  state.activeItemId = item.id;
  state.category = item.category || null;
  state.product = item.product || null;
  state.sku = item.sku || null;
  state.measurements = item.measurements ? { ...item.measurements } : state.measurements;
  state.quantity = item.quantity ?? null;
  state.finishes = Array.isArray(item.finishes) ? [...item.finishes] : [];
  state.environment = item.environment || null;
  state.letterCount = item.letterCount ?? null;
  state.letterHeight = item.letterHeight ?? null;
  state.formula = item.formulaType || null;
  state.formulaType = item.formulaType || null;
  state.baseWidth = item.baseWidth ?? null;
  state.baseHeight = item.baseHeight ?? null;
  state.baseAreaM2 = item.baseAreaM2 ?? null;
  state.basePrice = item.basePrice ?? null;
  state.minimumPrice = item.minimumPrice ?? null;
  state.calculatedPrice = item.calculatedPrice ?? null;
  state.calculationBreakdown = item.calculationBreakdown || null;
  state.priceSource = item.priceSource || null;
  state.verifiedPrice = item.verifiedPrice || null;
  state.conversationStatus = item.status || state.conversationStatus;
  return state;
}

function buildCommercialLookupText({
  message,
  history,
  commercialState
} = {}) {
  const state = commercialState && typeof commercialState === 'object'
    ? commercialState
    : null;

  if (state) {
    return [
      state.sku ? `sku:${state.sku}` : null,
      state.product ? `producto:${state.product}` : null,
      state.category ? `categoria:${state.category}` : null,
      state.intent ? `intencion:${state.intent}` : null,
      state.measurements?.width && state.measurements?.height
        ? `medidas:${state.measurements.width}x${state.measurements.height}${state.measurements.unit || ''}`
        : null,
      state.quantity ? `cantidad:${state.quantity}` : null,
      state.environment ? `ambiente:${state.environment}` : null,
      Array.isArray(state.finishes) && state.finishes.length
        ? `acabados:${state.finishes.join(',')}`
        : null,
      String(message || '').trim()
    ].filter(Boolean).join('\n');
  }

  const previousUserMessages = Array.isArray(history)
    ? history
        .filter(item => item?.role === 'user')
        .slice(-MAX_COMMERCIAL_HISTORY_MESSAGES)
        .map(item => String(item.content || '').trim())
        .filter(Boolean)
    : [];

  return [...previousUserMessages, String(message || '').trim()]
    .filter(Boolean)
    .join('\n');
}

function resolveKnowledgePlatform(platform) {
  return normalizePlatform(
    platform ||
    process.env.WAHA_DEFAULT_PLATFORM ||
    process.env.ELAN_AI_DEFAULT_PLATFORM ||
    DEFAULT_COMMERCIAL_PLATFORM
  );
}

async function loadCommercialContext(
  { message, history, platform, commercialState } = {},
  {
    fetchOffer = fetchCommercialOffer,
    loadKnowledge = loadPlatformKnowledgeSafely
  } = {}
) {
  const lookupText = buildCommercialLookupText({
    message,
    history,
    commercialState
  });
  const resolvedPlatform = resolveKnowledgePlatform(
    platform || commercialState?.platform || DEFAULT_COMMERCIAL_PLATFORM
  );

  let offerError = null;
  const [offerResult, platformKnowledge] = await Promise.all([
    Promise.resolve()
      .then(() => fetchOffer(lookupText))
      .catch((error) => {
        offerError = error;
        return null;
      }),
    Promise.resolve()
      .then(() => loadKnowledge({
        platform: resolvedPlatform,
        query: lookupText
      }))
      .catch(() => null)
  ]);

  const offer = offerResult || (offerError
    ? buildLocalFallbackOffer({
        message,
        commercialState,
        lookupText,
        error: offerError
      })
    : null);
  const knowledgeAvailable = Boolean(
    platformKnowledge?.available &&
    platformKnowledge?.payload
  );

  if (!offer && !knowledgeAvailable && !commercialState?.sku) return null;

  return Object.freeze({
    available: true,
    source: offer?.source || (commercialState?.sku ? 'Persistent Commercial State' : 'ELANKAV CONNECT'),
    productId: offer?.productId || commercialState?.sku || null,
    productName: offer?.productName || commercialState?.product || null,
    description: offer?.description || null,
    specifications: offer?.specifications || offer?.dimensions || commercialState?.measurements || null,
    priceOffers: Array.isArray(offer?.priceOffers)
      ? offer.priceOffers
      : commercialState?.verifiedPrice
        ? [commercialState.verifiedPrice]
      : [],
    variants: Array.isArray(offer?.variants)
      ? offer.variants
      : [],
    salesGuidance: offer?.salesGuidance || null,
    commercialRules: offer?.commercialRules || null,
    category: offer?.category || commercialState?.category || null,
    formulaType: offer?.formulaType || offer?.commercialRules?.formulaType || commercialState?.formulaType || null,
    calculation: offer?.calculation || null,
    priceSource: offer?.priceSource || null,
    fallbackUsed: offer?.fallbackUsed === true,
    alternatives: Array.isArray(offer?.alternatives) ? offer.alternatives : [],
    matchedAlias: offer?.matchedAlias || null,
    score: offer?.score || null,
    platformKnowledge: knowledgeAvailable
      ? Object.freeze({
          source: platformKnowledge.source || 'ELANKAV_CONNECT',
          policy: platformKnowledge.policy || 'approved-commercial-catalogs-only',
          platformId: platformKnowledge.platformId || resolvedPlatform,
          query: platformKnowledge.query || lookupText,
          payload: platformKnowledge.payload
        })
      : null,
    persistentState: commercialState || null,
    lookupText
  });
}

function updateCommercialState({
  previousState,
  message,
  commercial,
  platform
} = {}) {
  const next = cloneCommercialState(
    previousState || createEmptyCommercialState({ platform })
  );
  const previousSku = next.sku || null;
  const nextSku = commercial?.productId || null;
  const productChanged = Boolean(previousSku && nextSku && previousSku !== nextSku);

  if (productChanged) {
    syncActiveCommercialItem(next);
    const existingItem = (next.items || []).find(item => item.sku === nextSku);
    if (existingItem) {
      restoreCommercialItem(next, existingItem);
    } else {
    next.productHistory = [
      ...(next.productHistory || []),
      {
        sku: next.sku,
        product: next.product,
        category: next.category,
        measurements: next.measurements,
        quantity: next.quantity,
        finishes: next.finishes,
        environment: next.environment,
        formula: next.formula,
        calculatedPrice: next.calculatedPrice,
        verifiedPrice: next.verifiedPrice,
        archivedAt: new Date().toISOString()
      }
    ];
    next.measurements = {
      width: null,
      height: null,
      unit: null,
      sourceUnit: null,
      sourceWidth: null,
      sourceHeight: null,
      area: null,
      widthCm: null,
      heightCm: null
    };
    next.quantity = null;
    next.finishes = [];
    next.environment = null;
    next.letterCount = null;
    next.letterHeight = null;
    next.formula = null;
    next.formulaType = null;
    next.baseWidth = null;
    next.baseHeight = null;
    next.baseAreaM2 = null;
    next.basePrice = null;
    next.minimumPrice = null;
    next.calculatedPrice = null;
    next.calculationBreakdown = null;
    next.priceSource = null;
    next.verifiedPrice = null;
    next.activeItemId = `item-${(next.items || []).length + 1}`;
    }
  }

  const measurements = detectMeasurements(message);
  const quantity = detectQuantity(message);
  const environment = detectEnvironment(message);
  const finishes = detectFinishes(message);
  const letterCount = extractLetterCount(message);
  const letterHeight = extractLetterHeight(message);
  const intent = detectCommercialIntent(message);
  const category = detectCategory({ message, commercial });
  const verifiedPrice = resolveVerifiedPrice(commercial);

  next.platform = resolveKnowledgePlatform(platform || next.platform || DEFAULT_COMMERCIAL_PLATFORM);
  if (category) next.category = category;
  if (commercial?.productName) next.product = commercial.productName;
  if (commercial?.productId) next.sku = commercial.productId;
  if (intent) next.intent = intent;
  if (measurements) next.measurements = measurements;
  if (quantity) next.quantity = quantity;
  if (environment) next.environment = environment;
  if (letterCount) next.letterCount = letterCount;
  if (letterHeight) next.letterHeight = letterHeight;
  if (finishes.length) {
    next.finishes = [...new Set([...(next.finishes || []), ...finishes])];
  }
  next.formula = inferCommercialFormula({ commercial, state: next });
  if (verifiedPrice) next.verifiedPrice = verifiedPrice;
  applyCalculationDetails({ state: next, commercial });
  syncActiveCommercialItem(next);
  const physicalValidation = validatePhysicalDimensions({ commercial, state: next });
  if (physicalValidation) {
    next.conversationStatus = 'NEEDS_DIMENSION_CONFIRMATION';
    next.calculationBreakdown = {
      ...(next.calculationBreakdown || {}),
      physicalValidation
    };
  }
  next.conversationStatus = next.verifiedPrice
    ? physicalValidation
      ? 'NEEDS_DIMENSION_CONFIRMATION'
      : 'COTIZANDO'
    : next.sku || next.product
      ? physicalValidation
        ? 'NEEDS_DIMENSION_CONFIRMATION'
        : 'PRODUCTO_DETECTADO'
      : intent
        ? 'INTENCION_DETECTADA'
        : next.conversationStatus || 'INICIADO';
  next.documentUsed =
    commercial?.platformKnowledge?.payload?.catalogId ||
    commercial?.platformKnowledge?.payload?.catalog?.id ||
    next.documentUsed ||
    null;
  next.updatedAt = new Date().toISOString();

  return Object.freeze({
    ...next,
    measurements: Object.freeze({ ...next.measurements }),
    finishes: Object.freeze([...(next.finishes || [])]),
    verifiedPrice: next.verifiedPrice
      ? Object.freeze({ ...next.verifiedPrice })
      : null,
    productHistory: Object.freeze([...(next.productHistory || [])]),
    items: Object.freeze((next.items || []).map(item => Object.freeze({
      ...item,
      measurements: item.measurements ? Object.freeze({ ...item.measurements }) : null,
      finishes: Object.freeze([...(item.finishes || [])]),
      verifiedPrice: item.verifiedPrice ? Object.freeze({ ...item.verifiedPrice }) : null,
      calculationBreakdown: item.calculationBreakdown
        ? Object.freeze({ ...item.calculationBreakdown })
        : null
    }))),
    calculationBreakdown: next.calculationBreakdown
      ? Object.freeze({ ...next.calculationBreakdown })
      : null
  });
}

module.exports = {
  MAX_COMMERCIAL_HISTORY_MESSAGES,
  buildCommercialLookupText,
  clearPersistentCommercialState,
  createEmptyCommercialState,
  getPersistentCommercialState,
  loadPersistentCommercialState,
  resolveCommercialConversationKey,
  resolveKnowledgePlatform,
  savePersistentCommercialState,
  setCommercialStateRepositoryForTests,
  updateCommercialState,
  loadCommercialContext
};
