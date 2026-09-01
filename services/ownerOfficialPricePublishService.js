'use strict';

const { requestConnect } = require('./ownerBusinessConnectClient');

const COMMAND_TYPE = 'business_publish_official_price';

function normalize(value) {
  return String(value || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function detectOfficialPricePublish(message) {
  const text = normalize(message);
  if (!/\b(publica|publicar|habilita|habilitar|activa|activar)\b/.test(text)) return null;
  if (!/\b(precio|tarifa)\b/.test(text)) return null;
  if (!/\b(rotulo|boton|acrilico)\b/.test(text)) return null;
  if (/\b(bot[oó]n|boton)\b/.test(text) || (text.includes('rotulo') && text.includes('acrilico'))) {
    return Object.freeze({ type: COMMAND_TYPE, sku: 'rotulo-boton' });
  }
  return null;
}

function formatPublication(payload) {
  const result = payload?.data || payload || {};
  const product = result.product || {};
  const price = product.price || {};
  const measure = product.baseMeasure || {};
  const statusText = result.status === 'ALREADY_PUBLISHED' ? 'ya estaba publicado' : 'publicado correctamente';
  return [
    `✅ Precio oficial ${statusText}.`,
    `SKU: ${result.sku || 'rotulo-boton'}`,
    product.title ? `Producto: ${product.title}` : '',
    price.value != null ? `Precio: ${price.currency || 'USD'} ${price.value}` : '',
    measure.width != null || measure.height != null ? `Medida base: ${measure.width ?? '?'} × ${measure.height ?? '?'} m` : '',
    `Idempotente: ${result.idempotent === true ? 'SÍ' : 'NO'}`,
    'Autoridad: CONNECT → Plataformas IA → ELANVISUAL → Precios.'
  ].filter(Boolean).join('\n');
}

async function executeOfficialPricePublish(command, requestConnectImpl = requestConnect) {
  const sku = String(command?.sku || '').trim();
  if (sku !== 'rotulo-boton') {
    const error = new Error('SKU no autorizado para publicación Owner.');
    error.code = 'OWNER_PRICE_SKU_NOT_ALLOWED';
    throw error;
  }
  const payload = await requestConnectImpl('/api/v1/business/vqs/pricing/publish-official', {
    method: 'POST',
    body: { sku }
  });
  return { handled: true, outputText: formatPublication(payload), result: payload?.data || payload || null };
}

module.exports = { COMMAND_TYPE, detectOfficialPricePublish, executeOfficialPricePublish, formatPublication };
