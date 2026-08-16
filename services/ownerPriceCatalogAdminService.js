'use strict';

const { requestConnect } = require('./ownerBusinessConnectClient');

const COMMAND_TYPE = 'business_price_catalog_admin';

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function parseMoney(text) {
  const match = text.match(/(?:usd|us\$|u\$|c\$|nio)?\s*([0-9]+(?:[.,][0-9]+)?)/i);
  if (!match) return null;
  const amount = Number(match[1].replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const lead = normalize(text.slice(Math.max(0, (match.index || 0) - 8), (match.index || 0) + match[0].length));
  const currency = /c\$|nio/.test(lead) ? 'NIO' : 'USD';
  return { amount, currency };
}

function inferFormula(text) {
  const n = normalize(text);
  if (/m2|m²|metro cuadrado|metros cuadrados/.test(n)) return 'AREA_M2';
  if (/metro lineal|metros lineales|\/\s*m\b/.test(n)) return 'METRO_LINEAL';
  if (/unidad|unidades|pliego|pliegos|pieza|piezas/.test(n)) return 'UNIDAD';
  return null;
}

function detectOwnerPriceCatalogCommand(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw);
  if (!text.includes('elan')) return null;

  if (/^elan confirma reemplazar precios elanvisual$/.test(text)) {
    return Object.freeze({ type: COMMAND_TYPE, action: 'replace_confirm' });
  }

  if ((/reemplaza|reemplazar|limpia|limpiar|carga|cargar/.test(text)) && /catalogo/.test(text) && /precio|tarifa/.test(text) && /elanvisual/.test(text)) {
    return Object.freeze({ type: COMMAND_TYPE, action: 'replace_preview' });
  }

  const update = raw.match(/(?:cambia|cambiar|actualiza|actualizar|modifica|modificar)\s+(?:el\s+)?precio\s+de\s+(.+?)\s+a\s+((?:USD|US\$|U\$|C\$|NIO)?\s*[0-9]+(?:[.,][0-9]+)?)(.*)$/i);
  if (update) {
    const money = parseMoney(update[2]);
    if (money) return Object.freeze({ type: COMMAND_TYPE, action: 'update_price', query: update[1].trim(), amount: money.amount, currency: money.currency, formulaType: inferFormula(`${update[2]} ${update[3] || ''}`) });
  }

  const transition = raw.match(/(?:aprob[aá]|aprobar|public[aá]|publicar|archiva|archivar)\s+(?:el\s+)?(?:precio|tarifa)\s+(?:de\s+)?(.+)$/i);
  if (transition) {
    const verb = normalize(raw.split(/\s+/)[1] || '');
    const action = verb.startsWith('aprob') ? 'approve' : verb.startsWith('public') ? 'publish' : 'archive';
    return Object.freeze({ type: COMMAND_TYPE, action: 'transition', transitionAction: action, query: transition[1].trim() });
  }

  return null;
}

function formatPreview(payload) {
  const d = payload?.data || payload || {};
  const technologies = Object.entries(d.technologies || {}).sort((a,b)=>b[1]-a[1]).map(([k,v]) => `• ${k}: ${v}`).join('\n');
  return [
    '🔎 Previsualización del reemplazo de Precios de ELANVISUAL',
    `Registros actuales: ${d.existing ?? '?'}`,
    `Catálogo nuevo: ${d.incoming ?? '?'} registros`,
    `SKU únicos: ${d.uniqueSkus ?? '?'}`,
    `Pendientes de revisión/conflicto: ${d.review ?? '?'}`,
    technologies,
    '',
    'No modifiqué nada todavía.',
    'Para ejecutar: ELAN CONFIRMA REEMPLAZAR PRECIOS ELANVISUAL'
  ].filter((line) => line !== undefined).join('\n');
}

function formatReplace(payload) {
  const d = payload?.data || payload || {};
  return [
    '✅ Catálogo de Precios de ELANVISUAL reemplazado.',
    `Registros retirados: ${d.removed ?? '?'}`,
    `Registros cargados: ${d.inserted ?? '?'}`,
    `SKU únicos: ${d.uniqueSkus ?? '?'}`,
    `Pendientes de revisión/conflicto: ${d.review ?? '?'}`,
    `Snapshot de recuperación: ${d.snapshotId || 'creado'}`,
    'Todos los precios nuevos quedaron en REVISIÓN y NO PUBLICADOS.',
    'CONNECT y ELAN operan la misma data oficial.'
  ].join('\n');
}

function priceLabel(item) {
  if (item.pricePerM2 != null) return `${item.currency || 'USD'} ${item.pricePerM2}/m²`;
  if (item.pricePerLinearMeter != null) return `${item.currency || 'USD'} ${item.pricePerLinearMeter}/m`;
  if (item.unitPrice != null) return `${item.currency || 'USD'} ${item.unitPrice}/unidad`;
  if (item.basePrice != null) return `${item.currency || 'USD'} ${item.basePrice}`;
  return 'sin tarifa';
}

function formatMatches(matches) {
  return (matches || []).slice(0, 10).map((item, index) => `${index + 1}. ${item.name} [${item.sku}] — ${priceLabel(item)}`).join('\n');
}

async function resolveUnique(query, requestConnectImpl) {
  const payload = await requestConnectImpl(`/api/v1/business/vqs/pricing/catalog-admin/search?q=${encodeURIComponent(query)}`, { method: 'GET' });
  const d = payload?.data || payload || {};
  const matches = Array.isArray(d.matches) ? d.matches : [];
  return { count: matches.length, matches };
}

async function executeOwnerPriceCatalogCommand(command, requestConnectImpl = requestConnect) {
  if (command.action === 'replace_preview') {
    const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/preview', { method: 'GET' });
    return { handled: true, outputText: formatPreview(payload), result: payload?.data || payload };
  }

  if (command.action === 'replace_confirm') {
    const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/replace', { method: 'POST', body: { confirm: 'REPLACE_ELANVISUAL_PRICES' } });
    return { handled: true, outputText: formatReplace(payload), result: payload?.data || payload };
  }

  if (command.action === 'update_price') {
    const body = { query: command.query, amount: command.amount, currency: command.currency, ...(command.formulaType ? { formulaType: command.formulaType } : {}) };
    const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/catalog-admin/update-price', { method: 'POST', body });
    const d = payload?.data || payload || {};
    if (d.status === 'MULTIPLE' || d.status === 'NOT_FOUND') {
      return { handled: true, outputText: d.status === 'MULTIPLE' ? `Encontré varias tarifas compatibles. Especificá tecnología o variante:\n${formatMatches(d.matches)}` : `No encontré una tarifa única para “${command.query}”. No modifiqué precios.`, result: d };
    }
    const product = d.product || d?.data?.product || {};
    return { handled: true, outputText: `✅ Precio actualizado en CONNECT → Precios.\n${product.name || command.query}\nNuevo valor: ${command.currency} ${command.amount}${command.formulaType === 'AREA_M2' ? '/m²' : command.formulaType === 'METRO_LINEAL' ? '/m' : command.formulaType === 'UNIDAD' ? '/unidad' : ''}\nQuedó en REVISIÓN y debe aprobarse/publicarse antes de que ELAN lo use automáticamente.`, result: d };
  }

  if (command.action === 'transition') {
    const found = await resolveUnique(command.query, requestConnectImpl);
    if (found.count !== 1) {
      return { handled: true, outputText: found.count ? `Encontré varias tarifas. Decime cuál corresponde:\n${formatMatches(found.matches)}` : `No encontré la tarifa “${command.query}”. No modifiqué nada.`, result: found };
    }
    const item = found.matches[0];
    const payload = await requestConnectImpl(`/api/v1/business/vqs/pricing/catalog-admin/${encodeURIComponent(item.id)}/action`, { method: 'POST', body: { action: command.transitionAction } });
    const d = payload?.data || payload || {};
    const verb = command.transitionAction === 'approve' ? 'aprobada' : command.transitionAction === 'publish' ? 'publicada para ELAN' : 'archivada';
    return { handled: true, outputText: `✅ Tarifa ${verb}.\n${item.name}\nSKU: ${item.sku}\nLa modificación quedó en la misma fuente oficial de CONNECT → Precios.`, result: d };
  }

  return { handled: false };
}

module.exports = {
  COMMAND_TYPE,
  detectOwnerPriceCatalogCommand,
  executeOwnerPriceCatalogCommand,
  formatPreview,
  formatReplace,
  inferFormula,
  parseMoney
};
