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

function detectConnectRuntimeAudit(message) {
  const text = normalize(message);
  if (!/\b(audita|auditar|revisa|revisar|verifica|verificar|diagnostica|diagnosticar)\b/.test(text)) return null;
  if (!/\b(connect|fuente|supabase|precios?|catalogo)\b/.test(text)) return null;
  if (!(/\b(fuente|supabase|precios?|catalogo|runtime|datos)\b/.test(text) && /\b(connect|precios?|catalogo|supabase)\b/.test(text))) return null;
  return Object.freeze({ type: COMMAND_TYPE });
}

function formatProbe(probe) {
  if (!probe) return 'no disponible';
  if (probe.ok === false) return `ERROR ${probe.error || 'UNKNOWN'}`;
  if (typeof probe.count === 'number') return `${probe.count}`;
  return 'OK';
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
    schema.error ? `Error de esquema: ${schema.error}` : '',
    `Prueba resolver: ${resolver.ok === false ? `ERROR ${resolver.error || 'UNKNOWN'}` : (resolver.status || 'UNKNOWN')}`,
    resolver.matchCount != null ? `Coincidencias: ${resolver.matchCount}` : '',
    matches.length ? `Productos: ${matches.join(', ')}` : '',
    '',
    'Secretos expuestos: NO',
    'No se modificaron datos ni servicios.'
  ].filter(Boolean).join('\n');
}

async function executeConnectRuntimeAudit(requestConnectImpl = requestConnect) {
  const payload = await requestConnectImpl('/api/v1/business/vqs/runtime-audit');
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
  formatRuntimeAudit
};
