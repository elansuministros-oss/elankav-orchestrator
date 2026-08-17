'use strict';

const { listSellers } = require('./ownerSellerConnectClient');

const COMMAND_TYPE = 'owner_seller_read';

function clean(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

function normalizeSellerRows(payload) {
  if (Array.isArray(payload?.data?.sellers)) return payload.data.sellers;
  if (Array.isArray(payload?.sellers)) return payload.sellers;
  if (Array.isArray(payload)) return payload;
  return [];
}

function sellerName(seller = {}) {
  return clean(seller.display_name || seller.displayName || seller.legal_name || seller.legalName);
}

function sellerCode(seller = {}) {
  return clean(seller.seller_code || seller.sellerCode);
}

function sellerPhone(seller = {}) {
  return clean(seller.whatsapp || seller.phone);
}

function sellerPlatforms(seller = {}) {
  const rows = Array.isArray(seller.platforms) ? seller.platforms : [];
  return rows
    .filter(row => !row?.status || String(row.status).toLowerCase() === 'active')
    .map(row => clean(row.platform).toUpperCase())
    .filter(Boolean);
}

function detectOwnerSellerReadCommand(message) {
  const text = normalize(message)
    .replace(/^elan[\s,;:]+/, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  const sellerWord = /\bvendedor(?:es|a|as)?\b/.test(text);
  if (!sellerWord) return null;

  const registrationWrite = /\b(registra|registrar|agrega|agregar|crea|crear|carga|cargar|dar de alta|alta|habilita|habilitar|genera|generar|provisiona|provisionar)\b/.test(text);
  if (registrationWrite) return null;

  const listIntent = /\b(lista|listar|listame|muestra|muestrame|dame|ensena|ensename|quiero ver|ver todos|cuales son)\b/.test(text)
    && /\bvendedor(?:es|as)?\b/.test(text);
  if (listIntent || /^(?:los |las )?vendedor(?:es|as)$/.test(text)) {
    return Object.freeze({ type: COMMAND_TYPE, action: 'list' });
  }

  const searchPatterns = [
    /\b(?:busca|buscar|buscame|encuentra|encontra|localiza|localizar)\s+(?:al\s+|a\s+la\s+|el\s+|la\s+)?vendedor(?:a)?\s+(.+)$/,
    /\b(?:busca|buscar|buscame|encuentra|encontra|localiza|localizar)\s+(.+?)\s+(?:como\s+)?vendedor(?:a)?$/,
    /\bvendedor(?:a)?\s+(?:llamad[oa]\s+)?(.+)$/
  ];
  for (const pattern of searchPatterns) {
    const match = text.match(pattern);
    if (match && clean(match[1])) {
      return Object.freeze({ type: COMMAND_TYPE, action: 'search', query: clean(match[1]) });
    }
  }

  return null;
}

function sellerMatches(seller, query) {
  const q = normalize(query);
  if (!q) return false;
  const code = normalize(sellerCode(seller));
  const name = normalize(sellerName(seller));
  const email = normalize(seller.email);
  const phone = String(sellerPhone(seller)).replace(/\D/g, '');
  const queryPhone = String(query || '').replace(/\D/g, '');

  if (code && code === q) return true;
  if (email && email === q) return true;
  if (queryPhone && queryPhone.length >= 7 && phone === queryPhone) return true;
  return Boolean(name && (name === q || name.includes(q) || q.includes(name)));
}

function formatSeller(seller, index) {
  const name = sellerName(seller) || 'Sin nombre';
  const code = sellerCode(seller);
  const phone = sellerPhone(seller);
  const email = clean(seller.email);
  const status = clean(seller.status);
  const platforms = sellerPlatforms(seller);
  return [
    `${index}. ${name}`,
    code ? `Código: ${code}` : '',
    phone ? `WhatsApp: ${phone}` : '',
    email ? `Correo: ${email}` : '',
    platforms.length ? `Plataformas: ${platforms.join(', ')}` : '',
    status ? `Estado: ${status}` : ''
  ].filter(Boolean).join('\n');
}

function formatSellerList(sellers) {
  if (!sellers.length) return 'CONNECT no devolvió vendedores registrados en la autoridad oficial.';
  return [
    `Vendedores oficiales encontrados: ${sellers.length}`,
    '',
    ...sellers.flatMap((seller, index) => [formatSeller(seller, index + 1), '']),
    'Autoridad: crm_sellers + crm_seller_platforms.'
  ].join('\n').trim();
}

async function executeOwnerSellerReadCommand(command, dependencies = {}) {
  const listSellersImpl = dependencies.listSellers || listSellers;
  const payload = await listSellersImpl();
  const sellers = normalizeSellerRows(payload);

  if (command?.action === 'list') {
    return {
      handled: true,
      outputText: formatSellerList(sellers),
      result: { status: 'completed', count: sellers.length }
    };
  }

  if (command?.action === 'search') {
    const matches = sellers.filter(seller => sellerMatches(seller, command.query));
    return {
      handled: true,
      outputText: matches.length
        ? [`Vendedor${matches.length > 1 ? 'es' : ''} encontrado${matches.length > 1 ? 's' : ''}:`, '', ...matches.flatMap((seller, index) => [formatSeller(seller, index + 1), '']), 'Autoridad: crm_sellers + crm_seller_platforms.'].join('\n').trim()
        : `No encontré un vendedor oficial que coincida con “${clean(command.query)}” en CONNECT.`,
      result: { status: 'completed', count: matches.length }
    };
  }

  return { handled: false };
}

module.exports = {
  COMMAND_TYPE,
  detectOwnerSellerReadCommand,
  executeOwnerSellerReadCommand,
  formatSellerList,
  normalizeSellerRows,
  sellerMatches
};
