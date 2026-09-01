'use strict';

const marketplace = require('./ownerBusinessConnectClient');
const webSearch = require('./elanMarketplaceWebSearchService');
const sourceVerification = require('./elanMarketplaceSourceVerificationService');

const DISCOVERY_CATEGORIES = Object.freeze([
  {
    category: 'vehicle',
    focus: 'automóviles, pickups, camiones, buses, flotas y vehículos comerciales'
  },
  {
    category: 'motorcycle',
    focus: 'motocicletas, motos de trabajo, reparto y transporte'
  },
  {
    category: 'real_estate',
    focus: 'casas, terrenos, locales, bodegas, oficinas, fincas y propiedades para venta o alquiler'
  },
  {
    category: 'machinery',
    focus: 'maquinaria industrial, construcción, agrícola, generadores, montacargas y equipos pesados'
  },
  {
    category: 'product_equipment',
    focus: 'equipos, tecnología, herramientas, inventario, mobiliario y productos comerciales'
  },
  {
    category: 'service',
    focus: 'servicios empresariales, técnicos, transporte, instalación, mantenimiento y contratación'
  },
  {
    category: 'business',
    focus: 'negocios en venta, franquicias, inventarios comerciales, traspasos y oportunidades empresariales'
  },
  {
    category: 'investment',
    focus: 'inversiones, socios, capital, proyectos y oportunidades con retorno comercial'
  },
  {
    category: 'agro',
    focus: 'agricultura, ganadería, insumos, cosechas, fincas, equipos e intercambio agropecuario'
  }
]);

const OFFER_OPERATIONS = new Set([
  'sale',
  'rent',
  'service',
  'investment',
  'partnership'
]);

const DEMAND_INTENTS = new Set([
  'purchase',
  'rent',
  'service',
  'investment',
  'partnership'
]);

function clean(value) {
  return String(value || '').trim();
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.floor(parsed)
    : fallback;
}

function defaultRegion(env = process.env) {
  return clean(env.ELAN_MARKETPLACE_DISCOVERY_REGION) ||
    'Nicaragua primero; también Centroamérica y oportunidades internacionales que puedan venderse, entregarse o ejecutarse en Nicaragua';
}

function discoveryIntervalMs(env = process.env) {
  return positiveInteger(
    env.ELAN_MARKETPLACE_DISCOVERY_INTERVAL_MS,
    15 * 60 * 1000
  );
}

function selectDiscoveryCategory(now = Date.now(), env = process.env) {
  const interval = discoveryIntervalMs(env);
  const slot = Math.floor(Number(now) / interval);
  const index = ((slot % DISCOVERY_CATEGORIES.length) + DISCOVERY_CATEGORIES.length) %
    DISCOVERY_CATEGORIES.length;
  return DISCOVERY_CATEGORIES[index];
}

function selectCatalogCategories({
  now = Date.now(),
  env = process.env,
  count
} = {}) {
  const interval = discoveryIntervalMs(env);
  const slot = Math.floor(Number(now) / interval);
  const requested = positiveInteger(
    count,
    positiveInteger(env.ELAN_MARKETPLACE_CATALOG_SEARCHES_PER_RUN, 4)
  );
  const take = Math.max(1, Math.min(DISCOVERY_CATEGORIES.length, requested));
  const start =
    ((slot * take) % DISCOVERY_CATEGORIES.length + DISCOVERY_CATEGORIES.length) %
    DISCOVERY_CATEGORIES.length;

  const selected = [];
  for (let offset = 0; offset < take; offset += 1) {
    selected.push(
      DISCOVERY_CATEGORIES[(start + offset) % DISCOVERY_CATEGORIES.length]
    );
  }
  return selected;
}

function cleanLocation(input) {
  if (!input || typeof input !== 'object') return undefined;

  const country = clean(input.country);
  if (!country) return undefined;

  return {
    country,
    ...(clean(input.department) ? { department: clean(input.department) } : {}),
    ...(clean(input.municipality) ? { municipality: clean(input.municipality) } : {}),
    ...(clean(input.locality) ? { locality: clean(input.locality) } : {})
  };
}

function sourceName(raw, sourceUrl) {
  const explicit = clean(raw);
  if (explicit) return explicit.slice(0, 160);

  try {
    return new URL(sourceUrl).hostname.replace(/^www\./, '').slice(0, 160);
  } catch {
    return 'Web pública';
  }
}

function normalizeDiscovery(raw = {}, target = {}) {
  const kind = clean(target.kind) === 'demand' ? 'demand' : 'offer';
  const category = clean(target.category);
  const title = clean(raw.title);
  const sourceUrl = clean(raw.sourceUrl);

  if (!title || !/^https:\/\//i.test(sourceUrl)) return null;
  if (clean(raw.kind) !== kind) return null;
  if (clean(raw.category) !== category) return null;

  const operation = clean(raw.operation);
  const intent = clean(raw.intent);

  if (kind === 'offer' && !OFFER_OPERATIONS.has(operation)) return null;
  if (kind === 'demand' && !DEMAND_INTENTS.has(intent)) return null;

  const amount = Number(raw.priceAmount);
  const currency = clean(raw.priceCurrency).toUpperCase();
  const hasMoney =
    Number.isFinite(amount) &&
    amount > 0 &&
    ['USD', 'NIO'].includes(currency);

  const confidence = ['high', 'medium', 'low'].includes(
    clean(raw.confidence).toLowerCase()
  )
    ? clean(raw.confidence).toLowerCase()
    : 'medium';

  return {
    kind,
    title: title.slice(0, 220),
    ...(clean(raw.description)
      ? { description: clean(raw.description).slice(0, 10000) }
      : {}),
    category,
    subcategory: (clean(raw.subcategory) || clean(target.focus) || category)
      .slice(0, 120),
    ...(kind === 'offer'
      ? { operation }
      : { intent }),
    ...(hasMoney
      ? {
          priceAmount: amount,
          priceCurrency: currency
        }
      : {}),
    ...(cleanLocation(raw.location)
      ? { location: cleanLocation(raw.location) }
      : {}),
    sourceName: sourceName(raw.sourceName, sourceUrl),
    sourceUrl,
    ...(clean(raw.contactHint)
      ? { contactHint: clean(raw.contactHint).slice(0, 500) }
      : {}),
    confidence,
    metadata: {
      discoveryMode: 'autonomous_web_radar',
      searchFocus: clean(target.focus).slice(0, 300),
      searchRegion: clean(target.region).slice(0, 300)
    }
  };
}

async function runDiscoverySearch({
  target,
  env = process.env,
  searchWeb = webSearch.searchOpenMarketOpportunities,
  verifySource = sourceVerification.verifyDiscoverySource,
  persist = marketplace.marketplaceUpsertDiscovery
}) {
  const external = await searchWeb(target, env);
  const raw = Array.isArray(external?.discoveries)
    ? external.discoveries
    : [];

  const normalized = raw
    .map((item) => normalizeDiscovery(item, target))
    .filter(Boolean);

  const persisted = [];
  const rejected = [];

  for (const discovery of normalized) {
    const verification = await verifySource(discovery, env);

    if (!verification?.verified) {
      rejected.push({
        title: discovery.title,
        sourceUrl: discovery.sourceUrl,
        code: clean(verification?.code) || 'SOURCE_NOT_CONFIRMED'
      });
      continue;
    }

    const confirmed = {
      ...discovery,
      sourceUrl: clean(verification.finalUrl) || discovery.sourceUrl,
      verificationStatus: 'validated',
      ...(clean(verification.imageUrl)
        ? { imageUrl: clean(verification.imageUrl) }
        : {}),
      ...(Array.isArray(verification.imageUrls) && verification.imageUrls.length
        ? { imageUrls: verification.imageUrls.slice(0, 20) }
        : {}),
      ...(discovery.priceAmount !== undefined && verification.priceConfirmed !== true
        ? {
            priceAmount: undefined,
            priceCurrency: undefined
          }
        : {}),
      ...(discovery.location && verification.locationConfirmed !== true
        ? { location: undefined }
        : {}),
      ...(discovery.contactHint && verification.contactConfirmed !== true
        ? { contactHint: undefined }
        : {}),
      metadata: {
        ...(discovery.metadata || {}),
        sourceVerified: true,
        sourceVerificationCode: clean(verification.code) || 'SOURCE_CONFIRMED',
        sourceHttpStatus: Number(verification.statusCode) || 200,
        priceConfirmed: verification.priceConfirmed === true,
        locationConfirmed: verification.locationConfirmed === true,
        contactConfirmed: verification.contactConfirmed === true,
        sourcePageTitle: clean(verification.pageTitle).slice(0, 300),
        sourceDescriptionPresent: Boolean(clean(verification.sourceDescription)),
        verifiedAt: clean(verification.verifiedAt) || new Date().toISOString()
      }
    };

    if (confirmed.priceAmount === undefined) delete confirmed.priceAmount;
    if (confirmed.priceCurrency === undefined) delete confirmed.priceCurrency;
    if (confirmed.location === undefined) delete confirmed.location;
    if (confirmed.contactHint === undefined) delete confirmed.contactHint;

    const payload = await persist(confirmed, env);
    const result =
      payload &&
      typeof payload === 'object' &&
      Object.prototype.hasOwnProperty.call(payload, 'result')
        ? payload.result
        : payload;

    persisted.push({
      discoveryCode: clean(result?.discoveryCode) || null,
      kind: confirmed.kind,
      category: confirmed.category,
      title: confirmed.title,
      sourceUrl: confirmed.sourceUrl
    });
  }

  return {
    target,
    found: raw.length,
    accepted: normalized.length,
    verified: persisted.length,
    rejected: rejected.length,
    published: persisted.length,
    searchSummary: clean(external?.searchSummary),
    rejectedSources: rejected,
    persisted
  };
}

async function runCatalogDiscoveryCycle({
  env = process.env,
  now = Date.now(),
  mode = 'bootstrap',
  searchWeb = webSearch.searchOpenMarketOpportunities,
  verifySource = sourceVerification.verifyDiscoverySource,
  persist = marketplace.marketplaceUpsertDiscovery
} = {}) {
  const region = defaultRegion(env);
  const bootstrap = clean(mode).toLowerCase() === 'bootstrap';
  const requested = bootstrap
    ? positiveInteger(
        env.ELAN_MARKETPLACE_CATALOG_BOOTSTRAP_SEARCHES_PER_RUN,
        4
      )
    : positiveInteger(
        env.ELAN_MARKETPLACE_CATALOG_REPLENISH_SEARCHES_PER_RUN,
        2
      );

  const categories = selectCatalogCategories({
    now,
    env,
    count: requested
  });

  const results = [];
  let published = 0;

  for (const category of categories) {
    const target = {
      kind: 'offer',
      category: category.category,
      focus: category.focus,
      region
    };

    const result = await runDiscoverySearch({
      target,
      env,
      searchWeb,
      verifySource,
      persist
    });

    results.push(result);
    published += Number(result.published || 0);
  }

  return {
    ok: true,
    autonomous: true,
    authority: 'CONNECT',
    operator: 'ELAN',
    mode: bootstrap ? 'CATALOG_BOOTSTRAP' : 'CATALOG_REPLENISH',
    categories: categories.map((item) => item.category),
    searches: results.length,
    published,
    results
  };
}

async function runAutonomousDiscoveryCycle({
  env = process.env,
  now = Date.now(),
  searchWeb = webSearch.searchOpenMarketOpportunities,
  verifySource = sourceVerification.verifyDiscoverySource,
  persist = marketplace.marketplaceUpsertDiscovery
} = {}) {
  const category = selectDiscoveryCategory(now, env);
  const region = defaultRegion(env);
  const maximumSearches = Math.max(
    1,
    Math.min(
      2,
      positiveInteger(
        env.ELAN_MARKETPLACE_DISCOVERY_SEARCHES_PER_RUN,
        2
      )
    )
  );

  const targets = [
    {
      kind: 'offer',
      category: category.category,
      focus: category.focus,
      region
    },
    {
      kind: 'demand',
      category: category.category,
      focus: category.focus,
      region
    }
  ].slice(0, maximumSearches);

  const results = [];
  let published = 0;

  for (const target of targets) {
    const result = await runDiscoverySearch({
      target,
      env,
      searchWeb,
      verifySource,
      persist
    });
    results.push(result);
    published += result.published;
  }

  return {
    ok: true,
    autonomous: true,
    authority: 'CONNECT',
    operator: 'ELAN',
    category: category.category,
    focus: category.focus,
    searches: results.length,
    published,
    results
  };
}

module.exports = {
  DISCOVERY_CATEGORIES,
  cleanLocation,
  defaultRegion,
  discoveryIntervalMs,
  normalizeDiscovery,
  runAutonomousDiscoveryCycle,
  runCatalogDiscoveryCycle,
  runDiscoverySearch,
  selectCatalogCategories,
  selectDiscoveryCategory
};
