'use strict';

const OpenAI = require('openai');

function clean(value) {
  return String(value || '').trim();
}

function model(env = process.env) {
  return clean(env.ELAN_MARKETPLACE_SEARCH_MODEL || env.OPENAI_MODEL || 'gpt-5-mini');
}

function client(env = process.env) {
  const apiKey = clean(env.OPENAI_API_KEY);
  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY no configurada para ELAN GO.');
    error.code = 'MARKETPLACE_OPENAI_NOT_CONFIGURED';
    error.statusCode = 503;
    throw error;
  }
  return new OpenAI({ apiKey });
}

function promptForDemand(demand = {}) {
  const budget = demand.budget && typeof demand.budget === 'object'
    ? demand.budget
    : null;
  const location = demand.preferredLocation || demand.location || null;

  return [
    'Sos ELAN, intermediario comercial autónomo de ELANKAV.',
    'Buscá ofertas reales y actuales que puedan satisfacer esta demanda.',
    'Priorizá fuentes públicas verificables, marketplaces, negocios, proveedores y directorios.',
    'No inventes precios, contactos ni URLs.',
    'Devolvé SOLO JSON válido con esta forma:',
    '{"searchSummary":"...","candidates":[{"title":"...","providerName":null,"summary":"...","sourceUrl":"https://...","priceAmount":null,"priceCurrency":null,"location":null,"contact":null,"confidence":"high"}]}',
    'confidence solo puede ser high, medium o low.',
    'priceCurrency solo USD, NIO o null.',
    'contact debe ser un teléfono, WhatsApp, email, formulario o usuario de plataforma si aparece publicado.',
    'Máximo 8 candidatos.',
    '',
    'DEMANDA:',
    JSON.stringify({
      demandCode: demand.demandCode || demand.id || null,
      title: demand.title || '',
      description: demand.description || '',
      category: demand.category || '',
      subcategory: demand.subcategory || '',
      intent: demand.intent || '',
      requirements: demand.requirements || {},
      budget,
      location
    })
  ].join('\n');
}

function promptForOpenDiscovery(target = {}) {
  const kind = clean(target.kind) === 'demand' ? 'demand' : 'offer';
  const category = clean(target.category);
  const focus = clean(target.focus);
  const region = clean(target.region) || 'Nicaragua y oportunidades regionales o internacionales utilizables en Nicaragua';

  const objective = kind === 'offer'
    ? 'Encontrá cosas reales que alguien esté ofreciendo, vendiendo, alquilando o prestando como servicio.'
    : 'Encontrá compradores, empresas o personas que públicamente estén buscando, solicitando, cotizando o necesitando comprar, alquilar, contratar, invertir o asociarse.';

  return [
    'Sos ELAN, broker comercial autónomo de ELANKAV.',
    'Tu trabajo NO depende de una solicitud previa. Salís activamente a encontrar oportunidades comerciales en la web.',
    objective,
    '',
    'BUSCÁ EN TODAS LAS FUENTES PÚBLICAS O AUTORIZADAS QUE SEAN TÉCNICAMENTE ACCESIBLES:',
    '- web abierta y buscadores',
    '- marketplaces y clasificados',
    '- publicaciones, páginas, perfiles y grupos públicos indexados de redes sociales',
    '- Facebook Marketplace y publicaciones públicas cuando sean accesibles sin eludir controles',
    '- Instagram, TikTok y otras redes cuando el contenido comercial sea público/indexado',
    '- sitios de empresas, fabricantes, distribuidores y proveedores',
    '- directorios empresariales',
    '- portales sectoriales de vehículos, inmuebles, maquinaria, agro, servicios, inversión y negocios',
    '- subastas, liquidaciones y negocios en venta',
    '- licitaciones, RFQ, solicitudes de cotización, compras y necesidades públicas',
    '- foros, tableros y comunidades públicas',
    '',
    'Nunca eludas login, paywalls, CAPTCHA ni controles de acceso.',
    'No inventes URLs, precios, contactos ni entidades.',
    'Cada resultado debe corresponder a una página real encontrada durante esta búsqueda.',
    '',
    'Devolvé SOLO JSON válido:',
    '{"searchSummary":"...","discoveries":[{"kind":"offer","title":"...","description":"...","category":"vehicle","subcategory":"pickup","operation":"sale","intent":null,"priceAmount":18000,"priceCurrency":"USD","location":{"country":"Nicaragua","department":"Managua"},"sourceName":"...","sourceUrl":"https://...","contactHint":null,"confidence":"high"}]}',
    '',
    'REGLAS:',
    '- kind debe ser exactamente ' + JSON.stringify(kind),
    '- category debe ser exactamente ' + JSON.stringify(category),
    '- para offer: operation debe ser sale, rent, service, investment o partnership; intent=null',
    '- para demand: intent debe ser purchase, rent, service, investment o partnership; operation=null',
    '- priceCurrency solo USD, NIO o null',
    '- confidence solo high, medium o low',
    '- contactHint solo si el contacto aparece públicamente en la fuente',
    '- sourceUrl debe ser la URL real de la fuente encontrada',
    '- máximo 10 resultados',
    '',
    'ÁREA PRIORITARIA:',
    region,
    '',
    'FOCO COMERCIAL:',
    focus || category
  ].join('\n');
}

function outputText(response) {
  if (clean(response?.output_text)) return clean(response.output_text);

  const parts = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === 'output_text' && clean(content.text)) {
        parts.push(clean(content.text));
      }
    }
  }
  return parts.join('\n').trim();
}

function extractSources(response) {
  const sources = [];
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    for (const content of Array.isArray(item?.content) ? item.content : []) {
      for (const annotation of Array.isArray(content?.annotations) ? content.annotations : []) {
        const url = clean(annotation?.url || annotation?.url_citation?.url);
        if (url && !sources.includes(url)) sources.push(url);
      }
    }
  }
  return sources;
}

function parseJson(text) {
  const raw = clean(text)
    .replace(/^\`\`\`json\s*/i, '')
    .replace(/^\`\`\`\s*/i, '')
    .replace(/\s*\`\`\`$/, '');

  try {
    return JSON.parse(raw);
  } catch {
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(raw.slice(start, end + 1));
    throw new Error('INVALID_JSON');
  }
}

async function executeSearch({ demand = {}, toolType = 'web_search', env = process.env } = {}) {
  const openai = client(env);

  const response = await openai.responses.create({
    model: model(env),
    reasoning: { effort: 'low' },
    tools: [{ type: toolType }],
    input: promptForDemand(demand),
    max_output_tokens: 12000
  }, {
    timeout: 180000
  });

  let parsed;
  try {
    parsed = parseJson(outputText(response));
  } catch {
    const error = new Error('OpenAI devolvió una respuesta de búsqueda no estructurada.');
    error.code = 'MARKETPLACE_WEB_SEARCH_INVALID_OUTPUT';
    error.statusCode = 502;
    throw error;
  }

  return {
    ok: true,
    provider: 'openai',
    model: response.model || null,
    responseId: response.id || null,
    candidates: Array.isArray(parsed.candidates) ? parsed.candidates : [],
    searchSummary: clean(parsed.searchSummary),
    sources: extractSources(response),
    usage: response.usage || null
  };
}

function sameSource(candidateUrl, citedUrls = []) {
  try {
    const candidate = new URL(clean(candidateUrl));
    return citedUrls.some((source) => {
      try {
        const cited = new URL(clean(source));
        return (
          cited.href === candidate.href ||
          cited.hostname.toLowerCase() === candidate.hostname.toLowerCase()
        );
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function executeOpenDiscoverySearch({
  target = {},
  toolType = 'web_search',
  env = process.env
} = {}) {
  const openai = client(env);

  const response = await openai.responses.create({
    model: model(env),
    reasoning: { effort: 'low' },
    tools: [{ type: toolType }],
    input: promptForOpenDiscovery(target),
    max_output_tokens: 14000
  }, {
    timeout: 180000
  });

  let parsed;
  try {
    parsed = parseJson(outputText(response));
  } catch {
    const error = new Error('OpenAI devolvió descubrimientos web no estructurados.');
    error.code = 'MARKETPLACE_DISCOVERY_SEARCH_INVALID_OUTPUT';
    error.statusCode = 502;
    throw error;
  }

  const sources = extractSources(response);
  const discoveries = (Array.isArray(parsed.discoveries) ? parsed.discoveries : [])
    .filter((item) => item && typeof item === 'object')
    .filter((item) => /^https:\/\//i.test(clean(item.sourceUrl)))
    .filter((item) => sameSource(item.sourceUrl, sources));

  return {
    ok: true,
    provider: 'openai',
    model: response.model || null,
    responseId: response.id || null,
    discoveries,
    searchSummary: clean(parsed.searchSummary),
    sources,
    usage: response.usage || null
  };
}

async function searchOpenMarketOpportunities(target = {}, env = process.env) {
  try {
    return await executeOpenDiscoverySearch({
      target,
      toolType: 'web_search',
      env
    });
  } catch (error) {
    const text = [clean(error?.message), clean(error?.code)]
      .join(' ')
      .toLowerCase();

    const unsupported =
      error?.status === 400 ||
      error?.statusCode === 400 ||
      text.includes('web_search') ||
      text.includes('tool');

    if (!unsupported) throw error;

    return executeOpenDiscoverySearch({
      target,
      toolType: 'web_search_preview',
      env
    });
  }
}

async function searchMarketplaceNeed(demand = {}, env = process.env) {
  try {
    return await executeSearch({ demand, toolType: 'web_search', env });
  } catch (error) {
    const text = [clean(error?.message), clean(error?.code)].join(' ').toLowerCase();
    const unsupported =
      error?.status === 400 ||
      error?.statusCode === 400 ||
      text.includes('web_search') ||
      text.includes('tool');

    if (!unsupported) throw error;

    return executeSearch({
      demand,
      toolType: 'web_search_preview',
      env
    });
  }
}

module.exports = {
  executeOpenDiscoverySearch,
  executeSearch,
  extractSources,
  promptForDemand,
  promptForOpenDiscovery,
  sameSource,
  searchMarketplaceNeed,
  searchOpenMarketOpportunities
};
