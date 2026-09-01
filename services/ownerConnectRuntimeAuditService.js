'use strict';

const { requestConnect } = require('./ownerBusinessConnectClient');

const COMMAND_TYPE = 'business_connect_runtime_audit';

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function cleanAuditQuery(value) {
  return String(value || '')
    .trim()
    .replace(/^[“”"'‘’]+|[“”"'‘’]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 200);
}

function extractProductAuditQuery(message) {
  const original = String(message || '').trim();
  const quoted = original.match(/[“"'‘]([^”"'’]{2,200})[”"'’]/);
  if (quoted?.[1]) return cleanAuditQuery(quoted[1]);

  const related = original.match(/\b(?:relacionad[oa]s?\s+con|sobre|acerca\s+de)\s+([^.,;\n]{2,200})/i);
  if (related?.[1]) return cleanAuditQuery(related[1]);
  return null;
}

function detectConnectRuntimeAudit(message) {
  const text = normalize(message);
  if (!/\b(audita|auditar|revisa|revisar|verifica|verificar|diagnostica|diagnosticar)\b/.test(text)) return null;
  if (!/\b(connect|fuente|supabase|precios?|catalogo|plataforma ia)\b/.test(text)) return null;
  if (!(/\b(fuente|supabase|precios?|catalogo|runtime|datos|productos?)\b/.test(text) && /\b(connect|precios?|catalogo|supabase|plataforma ia)\b/.test(text))) return null;
  return Object.freeze({ type: COMMAND_TYPE, query: extractProductAuditQuery(message) });
}

function formatProbe(probe) {
  if (!probe) return 'no disponible';
  if (probe.ok === false) return `ERROR ${probe.error || 'UNKNOWN'}`;
  if (typeof probe.count === 'number') return `${probe.count}`;
  return 'OK';
}

function yesNoUnknown(value) {
  if (value === true) return 'SÍ';
  if (value === false) return 'NO';
  if (value === null || value === undefined || value === '') return 'NO DEFINIDO';
  return String(value);
}

function formatPrice(product) {
  const price = product?.price || {};
  if (price.value === null || price.value === undefined) return 'no definido';
  return `${price.currency || ''} ${price.value}`.trim();
}

function formatBaseMeasure(product) {
  const measure = product?.baseMeasure || {};
  if (measure.width != null && measure.height != null) return `${measure.width} × ${measure.height} m`;
  if (measure.areaM2 != null) return `${measure.areaM2} m²`;
  return 'no definida';
}

function formatProductDetail(detail) {
  if (!detail?.query) return [];
  const lines = [
    '',
    `Consulta de producto: ${detail.query}`,
    `Registros relacionados: ${detail.ok === false ? `ERROR ${detail.error || 'UNKNOWN'}` : detail.matchCount}`
  ];

  const products = Array.isArray(detail.products) ? detail.products.slice(0, 10) : [];
  for (const product of products) {
    lines.push(
      '',
      `• ${product.title || 'Producto sin título'}`,
      `  SKU: ${product.sku || 'no definido'}`,
      `  Status registro: ${product.recordStatus || 'no definido'}`,
      `  data.status: ${product.publicationStatus || 'no definido'}`,
      `  approved: ${yesNoUnknown(product.approved)}`,
      `  approvedPrice: ${yesNoUnknown(product.approvedPrice)}`,
      `  Precio: ${formatPrice(product)}`,
      `  Medida base: ${formatBaseMeasure(product)}`,
      `  Aliases: ${Array.isArray(product.aliases) && product.aliases.length ? product.aliases.join(', ') : 'ninguno'}`
    );
  }
  return lines;
}

function formatRuntimeAudit(payload) {
  const audit = payload?.data || payload || {};
  const runtime = audit.runtime || {};
  const supabase = audit.supabase || {};
  const data = audit.data || {};
  const schema = data.authorizedResolverSchema || {};
  const resolver = data.resolverProbe || {};
  const matches = Array.isArray(resolver.matches)
    ? resolver.matches.map((item) => item?.name || item?.id).filter(Boolean)
    : [];

  return [
    '🔎 Auditoría READ-ONLY de la fuente de precios de CONNECT.',
    '',
    `Runtime: ${runtime.deploymentTarget || 'UNKNOWN'}`,
    `Commit reportado: ${runtime.commit || 'no expuesto por el entorno'}`,
    `Supabase project ref: ${supabase.projectRef || 'no disponible'}`,
    `commercial_products visibles: ${formatProbe(data.commercialProducts)}`,
    `productos Plataforma IA visibles: ${formatProbe(data.aiPlatformKnowledge)}`,
    `Esquema compatible con resolver autorizado: ${schema.compatibleWithAuthorizedResolver === true ? 'SÍ' : 'NO'}`,
    schema.authorityTable ? `Fuente autorizada: ${schema.authorityTable}` : '',
    schema.error ? `Error de esquema: ${schema.error}` : '',
    `Prueba resolver: ${resolver.ok === false ? `ERROR ${resolver.error || 'UNKNOWN'}` : (resolver.status || 'UNKNOWN')}`,
    resolver.query ? `Consulta resolver: ${resolver.query}` : '',
    resolver.matchCount != null ? `Coincidencias autorizadas: ${resolver.matchCount}` : '',
    matches.length ? `Productos autorizados: ${matches.join(', ')}` : '',
    ...formatProductDetail(data.productDetailProbe),
    '',
    'Secretos expuestos: NO',
    'No se modificaron datos ni servicios.'
  ].filter((line) => line !== '').join('\n');
}

async function executeConnectRuntimeAudit(queryOrImpl = null, maybeRequestConnectImpl = requestConnect) {
  let query = queryOrImpl;
  let requestConnectImpl = maybeRequestConnectImpl;
  if (typeof queryOrImpl === 'function') {
    requestConnectImpl = queryOrImpl;
    query = null;
  }

  const cleanQuery = cleanAuditQuery(query);
  const suffix = cleanQuery ? `?${new URLSearchParams({ query: cleanQuery }).toString()}` : '';
  const payload = await requestConnectImpl(`/api/v1/business/vqs/runtime-audit${suffix}`);
  return {
    handled: true,
    outputText: formatRuntimeAudit(payload),
    result: payload?.data || payload || null
  };
}

module.exports = {
  COMMAND_TYPE,
  detectConnectRuntimeAudit,
  executeConnectRuntimeAudit,
  extractProductAuditQuery,
  formatRuntimeAudit
};
