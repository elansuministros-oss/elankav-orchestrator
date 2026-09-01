'use strict';

const { requestConnect } = require('./ownerBusinessConnectClient');

const COMMAND_TYPE = 'business_price_catalog_admin';

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function parseMoney(text) {
  const match = String(text || '').match(/(?:usd|us\$|u\$|c\$|nio)?\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const lead = normalize(String(text).slice(Math.max(0, (match.index || 0) - 8), (match.index || 0) + match[0].length));
  return { amount, currency: /c\$|nio/.test(lead) ? 'NIO' : 'USD' };
}

function inferFormula(text) {
  const n = normalize(text);
  if (/m2|m²|metro cuadrado|metros cuadrados/.test(n)) return 'AREA_M2';
  if (/metro lineal|metros lineales|\/\s*m\b/.test(n)) return 'METRO_LINEAL';
  if (/unidad|unidades|pliego|pliegos|pieza|piezas/.test(n)) return 'UNIDAD';
  return null;
}

function inferTechnology(value) {
  const n = normalize(value);
  if (n.includes('roland') || n.includes('truevis')) return 'ROLAND_TRUEVIS_LG_MG_UV';
  if (n.includes('epson') || n.includes('eco solvente') || n.includes('ecosolvente')) return 'EPSON_SURECOLOR_ECOSOLVENTE';
  if (n.includes('dtf uv')) return 'DTF_UV';
  if (n.includes('laser')) return 'LASER';
  if (n.includes('cnc') || n.includes('router')) return 'CNC_ROUTER';
  if (n.includes('sublim')) return 'SUBLIMACION';
  if (n.includes('uv')) return 'IMPRESION_UV';
  return 'POR_DEFINIR';
}

function detectOwnerPriceCatalogCommand(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!text.includes('elan')) return null;

  if (/^elan confirma reemplazar precios elanvisual$/.test(text)) return Object.freeze({ type: COMMAND_TYPE, action: 'replace_confirm' });
  if (/^elan confirma autorizar precios elanvisual$/.test(text)) return Object.freeze({ type: COMMAND_TYPE, action: 'authorize_all' });
  if ((/reemplaza|reemplazar|limpia|limpiar|carga|cargar/.test(text)) && /catalogo/.test(text) && /precio|tarifa/.test(text) && /elanvisual/.test(text)) return Object.freeze({ type: COMMAND_TYPE, action: 'replace_preview' });

  const create = raw.match(/(?:agrega|agregar|crea|crear)\s+(?:una\s+)?(?:tarifa|precio)(?:\s+nuev[ao])?\s+(?:para|de)\s+(.+?)\s+a\s+((?:USD|US\$|U\$|C\$|NIO)?\s*[0-9]+(?:[.,][0-9]+)?)(.*)$/i);
  if (create) {
    const money = parseMoney(create[2]);
    if (money) return Object.freeze({ type: COMMAND_TYPE, action: 'create_price', name: create[1].trim(), technology: inferTechnology(create[1]), amount: money.amount, currency: money.currency, formulaType: inferFormula(`${create[2]} ${create[3] || ''}`) || 'PRECIO_FIJO' });
  }

  const update = raw.match(/(?:cambia|cambiar|actualiza|actualizar|modifica|modificar)\s+(?:el\s+)?precio\s+de\s+(.+?)\s+a\s+((?:USD|US\$|U\$|C\$|NIO)?\s*[0-9]+(?:[.,][0-9]+)?)(.*)$/i);
  if (update) {
    const money = parseMoney(update[2]);
    if (money) return Object.freeze({ type: COMMAND_TYPE, action: 'update_price', query: update[1].trim(), amount: money.amount, currency: money.currency, formulaType: inferFormula(`${update[2]} ${update[3] || ''}`) });
  }

  const transition = raw.match(/(?:aprob[aá]|aprobar|public[aá]|publicar|archiva|archivar)\s+(?:el\s+)?(?:precio|tarifa)\s+(?:de\s+)?(.+)$/i);
  if (transition) {
    const verb = normalize(raw.split(/\s+/)[1] || '');
    return Object.freeze({ type: COMMAND_TYPE, action: 'transition', transitionAction: verb.startsWith('aprob') ? 'approve' : verb.startsWith('public') ? 'publish' : 'archive', query: transition[1].trim() });
  }
  return null;
}

function formatPreview(payload) {
  const d = payload?.data || payload || {};
  const technologies = Object.entries(d.technologies || {}).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `• ${k}: ${v}`).join('\n');
  return ['🔎 Previsualización del reemplazo de Precios de ELANVISUAL', `Registros actuales: ${d.existing ?? '?'}`, `Catálogo nuevo: ${d.incoming ?? '?'} registros`, `SKU únicos: ${d.uniqueSkus ?? '?'}`, `Pendientes de revisión/conflicto: ${d.review ?? '?'}`, technologies, '', 'No modifiqué nada todavía.', 'Para ejecutar: ELAN CONFIRMA REEMPLAZAR PRECIOS ELANVISUAL'].join('\n');
}
function formatReplace(payload) {
  const d = payload?.data || payload || {};
  return ['✅ Catálogo de Precios de ELANVISUAL reemplazado.', `Registros retirados: ${d.removed ?? '?'}`, `Registros cargados: ${d.inserted ?? '?'}`, `SKU únicos: ${d.uniqueSkus ?? '?'}`, `Pendientes de revisión/conflicto: ${d.review ?? '?'}`, `Snapshot de recuperación: ${d.snapshotId || 'creado'}`, 'Todos los precios nuevos quedaron en REVISIÓN y NO PUBLICADOS.', 'CONNECT y ELAN operan la misma data oficial.'].join('\n');
}
function formatAuthorization(payload) {
  const d = payload?.data || payload || {};
  return ['✅ Catálogo de Precios de ELANVISUAL autorizado.', `Registros totales: ${d.total ?? '?'}`, `Aprobados: ${d.approved ?? '?'}`, `Publicados: ${d.published ?? '?'}`, `Activos para ELAN: ${d.active ?? '?'}`, `Definiciones Owner aplicadas: ${d.ownerOverridesApplied ?? '?'}`, `Vigencia desde: ${d.effectiveFrom || '?'}`, 'Las tarifas “desde” quedan como referencia mínima y NO como precio final automático.', 'CONNECT y ELAN usan la misma autoridad oficial de Precios.'].join('\n');
}
function priceLabel(item) { if (item.pricePerM2 != null) return `${item.currency || 'USD'} ${item.pricePerM2}/m²`; if (item.pricePerLinearMeter != null) return `${item.currency || 'USD'} ${item.pricePerLinearMeter}/m`; if (item.unitPrice != null) return `${item.currency || 'USD'} ${item.unitPrice}/unidad`; if (item.basePrice != null) return `${item.currency || 'USD'} ${item.basePrice}`; return 'sin tarifa'; }
function formatMatches(matches) { return (matches || []).slice(0, 10).map((item, index) => `${index + 1}. ${item.name} [${item.sku}] — ${priceLabel(item)}`).join('\n'); }
async function resolveUnique(query, requestConnectImpl) { const payload = await requestConnectImpl(`/api/v1/business/vqs/pricing/catalog-admin/search?q=${encodeURIComponent(query)}`, { method: 'GET' }); const d = payload?.data || payload || {}; const matches = Array.isArray(d.matches) ? d.matches : []; return { count: matches.length, matches }; }

async function executeOwnerPriceCatalogCommand(command, requestConnectImpl = requestConnect) {
  if (command.action === 'replace_preview') { const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/preview', { method: 'GET' }); return { handled: true, outputText: formatPreview(payload), result: payload?.data || payload }; }
  if (command.action === 'replace_confirm') { const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/replace', { method: 'POST', body: { confirm: 'REPLACE_ELANVISUAL_PRICES' } }); return { handled: true, outputText: formatReplace(payload), result: payload?.data || payload }; }
  if (command.action === 'authorize_all') { const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/authorize-all', { method: 'POST', body: { confirm: 'AUTHORIZE_ELANVISUAL_PRICES' } }); return { handled: true, outputText: formatAuthorization(payload), result: payload?.data || payload }; }

  if (command.action === 'create_price') {
    const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/create', { method: 'POST', body: { name: command.name, technology: command.technology, amount: command.amount, currency: command.currency, formulaType: command.formulaType } });
    const d = payload?.data || payload || {};
    if (d.status === 'SKU_EXISTS') return { handled: true, outputText: `Ya existe una tarifa con ese SKU. No creé un duplicado.\n${d.product?.name || command.name}\n${d.product?.sku || ''}`, result: d };
    const product = d.product || d?.data?.product || {};
    return { handled: true, outputText: `✅ Nueva tarifa creada en CONNECT → Precios.\n${product.name || command.name}\nTecnología: ${command.technology}\nPrecio: ${command.currency} ${command.amount}${command.formulaType === 'AREA_M2' ? '/m²' : command.formulaType === 'METRO_LINEAL' ? '/m' : command.formulaType === 'UNIDAD' ? '/unidad' : ''}\nQuedó en REVISIÓN; todavía no está autorizada para cotizar automáticamente.`, result: d };
  }

  if (command.action === 'update_price') {
    const body = { query: command.query, amount: command.amount, currency: command.currency, ...(command.formulaType ? { formulaType: command.formulaType } : {}) };
    const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/update-price', { method: 'POST', body });
    const d = payload?.data || payload || {};
    if (d.status === 'MULTIPLE' || d.status === 'NOT_FOUND') return { handled: true, outputText: d.status === 'MULTIPLE' ? `Encontré varias tarifas compatibles. Especificá tecnología o variante:\n${formatMatches(d.matches)}` : `No encontré una tarifa única para “${command.query}”. No modifiqué precios.`, result: d };
    const product = d.product || d?.data?.product || {};
    return { handled: true, outputText: `✅ Precio actualizado en CONNECT → Precios.\n${product.name || command.query}\nNuevo valor: ${command.currency} ${command.amount}${command.formulaType === 'AREA_M2' ? '/m²' : command.formulaType === 'METRO_LINEAL' ? '/m' : command.formulaType === 'UNIDAD' ? '/unidad' : ''}\nQuedó en REVISIÓN y debe aprobarse/publicarse antes de que ELAN lo use automáticamente.`, result: d };
  }

  if (command.action === 'transition') {
    const found = await resolveUnique(command.query, requestConnectImpl);
    if (found.count !== 1) return { handled: true, outputText: found.count ? `Encontré varias tarifas. Decime cuál corresponde:\n${formatMatches(found.matches)}` : `No encontré la tarifa “${command.query}”. No modifiqué nada.`, result: found };
    const item = found.matches[0];
    const payload = await requestConnectImpl(`/api/v1/business/vqs/pricing/catalog-admin/${encodeURIComponent(item.id)}/action`, { method: 'POST', body: { action: command.transitionAction } });
    const d = payload?.data || payload || {};
    const verb = command.transitionAction === 'approve' ? 'aprobada' : command.transitionAction === 'publish' ? 'publicada para ELAN' : 'archivada';
    return { handled: true, outputText: `✅ Tarifa ${verb}.\n${item.name}\nSKU: ${item.sku}\nLa modificación quedó en la misma fuente oficial de CONNECT → Precios.`, result: d };
  }
  return { handled: false };
}

module.exports = { COMMAND_TYPE, detectOwnerPriceCatalogCommand, executeOwnerPriceCatalogCommand, formatPreview, formatReplace, formatAuthorization, inferFormula, inferTechnology, parseMoney };
