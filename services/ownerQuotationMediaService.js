'use strict';

const { randomUUID } = require('node:crypto');
const { readContext, updateContext } = require('./ownerBusinessContextService');
const { downloadWahaMedia } = require('./connectVoiceService');
const {
  getQuotation,
  listQuotations,
  removeQuotationImage,
  resolveCatalogPricing,
  searchCustomers,
  updateQuotation,
  uploadQuotationImage
} = require('./ownerBusinessConnectClient');

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const PENDING_TTL_MS = 15 * 60 * 1000;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const pendingMedia = new Map();

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[.!?]+$/g, '')
    .replace(/\s+/g, ' ');
}

function clone(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
}

function conversationKey({ externalUserId, phone }) {
  return String(externalUserId || phone || 'owner').trim();
}

function cleanPending(now = Date.now()) {
  for (const [key, value] of pendingMedia.entries()) {
    if (!value?.expiresAt || value.expiresAt <= now) pendingMedia.delete(key);
  }
}

function savePendingMedia(identity, media, now = Date.now()) {
  cleanPending(now);
  const key = conversationKey(identity);
  pendingMedia.set(key, {
    url: String(media?.url || '').trim(),
    mimeType: String(media?.mimeType || media?.mimetype || '').trim(),
    filename: String(media?.filename || 'imagen').trim(),
    expiresAt: now + PENDING_TTL_MS
  });
}

function readPendingMedia(identity, now = Date.now()) {
  cleanPending(now);
  return pendingMedia.get(conversationKey(identity)) || null;
}

function clearPendingMedia(identity) {
  pendingMedia.delete(conversationKey(identity));
}

function mediaIntent(message, { hasMediaContext = false } = {}) {
  const text = normalize(message).replace(/^elan[\s,;:]+/, '');
  const hasImageWord = /\b(imagen|foto|fotografia|fotografía)\b/.test(text);
  const referencesCurrentMedia = hasMediaContext && /\b(esta|esta imagen|esta foto|la imagen|la foto)\b/.test(text);
  const remove = /\b(quita|quita la|elimina|borra|remueve|saca)\b/.test(text) && hasImageWord;
  if (remove) return { action: 'remove' };

  const attachVerb = /\b(agrega|agregala|agregá|pone|ponela|poné|anade|añade|adjunta|adjuntala|usa|usala|cambia|cambiala|reemplaza|reemplazala)\b/.test(text);
  if (attachVerb && (hasImageWord || referencesCurrentMedia)) {
    const mode = /\b(agrega|agregala|agregá|anade|añade|adjunta|adjuntala)\b/.test(text) ? 'add' : 'replace';
    return { action: 'attach', mode };
  }
  return null;
}

function imageMedia(metadata = {}) {
  const media = metadata?.media && typeof metadata.media === 'object' ? metadata.media : null;
  const mimeType = String(media?.mimeType || media?.mimetype || '').split(';')[0].trim().toLowerCase();
  const messageType = String(metadata?.messageType || '').toLowerCase();
  if (!media?.url) return null;
  if (messageType !== 'image' && !mimeType.startsWith('image/')) return null;
  return {
    url: String(media.url).trim(),
    mimeType,
    filename: String(media.filename || 'imagen').trim()
  };
}

function safeWahaUrl(rawUrl) {
  const publicBase = String(process.env.WAHA_BASE_URL || 'https://waha.elankav.com').replace(/\/+$/, '');
  const internalBase = String(process.env.WAHA_INTERNAL_BASE_URL || publicBase).replace(/\/+$/, '');
  const target = new URL(String(rawUrl || ''), `${publicBase}/`);
  const allowedHosts = new Set([new URL(publicBase).host, new URL(internalBase).host]);
  if (!allowedHosts.has(target.host)) {
    const error = new Error('WAHA_MEDIA_HOST_NOT_ALLOWED');
    error.code = 'WAHA_MEDIA_HOST_NOT_ALLOWED';
    throw error;
  }
  return target.toString();
}

async function downloadImage(media, fetchImpl = fetch) {
  const downloaded = await downloadWahaMedia({ url: media.url, fetchImpl });
  const downloadedType = String(downloaded?.mimeType || '').split(';')[0].trim().toLowerCase();
  const webhookType = String(media?.mimeType || '').split(';')[0].trim().toLowerCase();
  const contentType = (!downloadedType || downloadedType === 'application/octet-stream' || downloadedType === 'binary/octet-stream')
    ? webhookType
    : downloadedType;

  if (!ALLOWED_IMAGE_TYPES.has(contentType)) {
    const error = new Error('Formato de imagen no permitido. Usá JPG, PNG o WEBP.');
    error.code = 'UNSUPPORTED_IMAGE_TYPE';
    error.statusCode = 415;
    throw error;
  }

  const buffer = Buffer.from(downloaded?.buffer || []);
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) {
    const error = new Error(buffer.length ? 'La imagen supera 8 MB.' : 'La imagen recibida está vacía.');
    error.code = buffer.length ? 'IMAGE_TOO_LARGE' : 'IMAGE_EMPTY';
    error.statusCode = buffer.length ? 413 : 422;
    throw error;
  }

  return { buffer, mimeType: contentType };
}

function quoteNumber(record, context) {
  return String(record?.quotationNumber || context?.activeQuotationNumber || context?.activeQuotationId || '').trim();
}

function stripHonorific(value) {
  return String(value || '')
    .replace(/^(?:la|el)\s+/i, '')
    .replace(/^(?:dra\.?|dr\.?|sra\.?|sr\.?|arq\.?)\s+/i, '')
    .trim();
}

function parseDimensionsWithUnit(message) {
  const match = String(message || '').match(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(cm|cms|centimetros|centímetros|m|mts|metros)?\b/i);
  if (!match) return {};
  let width = Number(match[1].replace(',', '.'));
  let height = Number(match[2].replace(',', '.'));
  const unit = normalize(match[3] || 'm');
  if (/^(cm|cms|centimetro|centimetros)$/.test(unit)) {
    width /= 100;
    height /= 100;
  }
  return { width, height, original: match[0].trim() };
}

function parseCustomerReference(message) {
  const raw = String(message || '');
  const patterns = [
    /\bcotizaci[oó]n\s+(?:de|para)\s+(.+?)(?=\s+(?:y|despu[eé]s|donde|que|para|luego)\b|[,.;]|$)/i,
    /\bcliente\s+(.+?)(?=\s+(?:y|despu[eé]s|donde|que|para|luego)\b|[,.;]|$)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return stripHonorific(match[1]);
  }
  return '';
}

function parseAnchorReference(message) {
  const raw = String(message || '');
  const patterns = [
    /\bdespu[eé]s\s+(?:del|de\s+la|de)\s+(?:item|ítem)?\s*(?:del|de\s+la|de)?\s*(.+?)(?=\s+(?:agrega|agregá|agregar|añade|anade|incluye|pone|poné)\b|[,.;]|$)/i,
    /\bdebajo\s+(?:del|de\s+la|de)\s+(?:item|ítem)?\s*(?:del|de\s+la|de)?\s*(.+?)(?=\s+(?:agrega|agregá|agregar|añade|anade|incluye|pone|poné)\b|[,.;]|$)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function cleanProductText(value) {
  return String(value || '')
    .replace(/^(?:como\s+)?(?:un|una|el|la)\s+nuevo\s+(?:item|ítem)\s*[:\-]?\s*/i, '')
    .replace(/^(?:un|una|el|la)\s+/i, '')
    .replace(/\s+(?:como\s+)?(?:un\s+)?nuevo\s+(?:item|ítem)\s*$/i, '')
    .replace(/[.;,]+$/g, '')
    .trim();
}

function parseAddQuotationItemRequest(message) {
  const raw = String(message || '').trim();
  const text = normalize(raw).replace(/^elan[\s,;:]+/, '');
  if (!/\bcotizacion\b/.test(text)) return null;
  if (!/\b(agrega|agregar|agregá|añade|anade|incluye|incorpora|pone|poné)\b/.test(text)) return null;
  if (/\b(imagen|foto|fotografia)\b/.test(text)) return null;

  const addMatches = [...raw.matchAll(/\b(?:agrega|agregar|agregá|añade|anade|incluye|incorpora|pone|poné)\b/gi)];
  if (!addMatches.length) return null;
  const start = addMatches[addMatches.length - 1].index + addMatches[addMatches.length - 1][0].length;
  let tail = raw.slice(start).trim();
  tail = tail.replace(/^a\s+(?:esta|la)\s+cotizaci[oó]n\s+/i, '');
  tail = tail.replace(/^(?:como\s+)?(?:un|una)\s+nuevo\s+(?:item|ítem)\s*[:\-]?\s*/i, '');
  tail = tail.replace(/\b(?:busca|buscá|buscar|toma|tomá|usa|usá)\s+(?:el\s+)?precio\b[\s\S]*$/i, '');
  tail = tail.replace(/\by\s+agregalo\s+como\s+(?:un\s+)?nuevo\s+(?:item|ítem)\b[\s\S]*$/i, '');
  const requestedDescription = cleanProductText(tail);
  if (!requestedDescription || /^(?:el|la)?\s*(?:nuevo\s+)?(?:item|ítem)$/i.test(requestedDescription)) return null;

  const dimensions = parseDimensionsWithUnit(requestedDescription);
  const productQuery = cleanProductText(requestedDescription
    .replace(/\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:cm|cms|centimetros|centímetros|m|mts|metros)?\b/gi, '')
    .replace(/\bde\s*$/i, '')
    .replace(/\s+/g, ' '));

  return {
    customerReference: parseCustomerReference(raw),
    anchorReference: parseAnchorReference(raw),
    requestedDescription,
    productQuery,
    width: dimensions.width,
    height: dimensions.height,
    quantity: 1
  };
}

function customerIdOfQuotation(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.customer_id || row?.customerId || publicDocument?.customer?.customerId || '').trim();
}

function projectIdOfQuotation(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.project_id || row?.projectId || publicDocument?.project?.projectId || '').trim();
}

function quotationStatus(row) {
  return normalize(row?.status || row?.quotation_status || row?.quotation_document?.publicDocument?.quotation?.status || '');
}

function quotationItems(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return Array.isArray(publicDocument.items) ? publicDocument.items : (Array.isArray(row?.items) ? row.items : []);
}

function quotationCustomerName(row) {
  const publicDocument = row?.quotation_document?.publicDocument || row?.quotationDocument?.publicDocument || {};
  return String(row?.customer_name || row?.customerName || publicDocument?.customer?.name || publicDocument?.customer?.companyName || '').trim();
}

function businessItems(items) {
  return (Array.isArray(items) ? items : []).filter(item => normalize(item?.source) !== 'logistics_library');
}

function itemLabel(item) {
  return String(item?.title || item?.description || item?.name || 'Ítem').trim();
}

function hasItemReference(row, reference) {
  if (!reference) return false;
  const wanted = normalize(reference);
  return businessItems(quotationItems(row)).some(item => {
    const label = normalize(`${item?.title || ''} ${item?.description || ''}`);
    return label.includes(wanted) || wanted.includes(label);
  });
}

function normalizeQuotationRows(payload) {
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.quotations)) return payload.data.quotations;
  if (Array.isArray(payload?.quotations)) return payload.quotations;
  if (Array.isArray(payload)) return payload;
  return [];
}

async function resolveCustomerByName(reference) {
  const response = await searchCustomers(reference);
  const rows = response?.data?.results || [];
  if (!rows.length) return { ready: false, question: `No encontré un cliente oficial que coincida con “${reference}”.` };
  const candidates = rows.map(row => row?.customer || row).filter(Boolean);
  const wanted = normalize(stripHonorific(reference));
  const exact = candidates.filter(customer => {
    const names = [customer?.name, customer?.companyName, customer?.displayName].filter(Boolean).map(name => normalize(stripHonorific(name)));
    return names.some(name => name === wanted);
  });
  const chosen = exact.length === 1 ? exact[0] : (candidates.length === 1 ? candidates[0] : null);
  if (!chosen) {
    const names = candidates.slice(0, 5).map(customer => customer?.name || customer?.companyName).filter(Boolean);
    return { ready: false, question: `Encontré varios clientes que coinciden con “${reference}”: ${names.join(', ')}. Decime cuál de esos nombres corresponde.` };
  }
  return { ready: true, customer: chosen };
}

async function resolveQuotationForHumanReference(request) {
  const context = await readContext();

  if (!request.customerReference && context.activeProjectId && context.activeQuotationId) {
    const response = await getQuotation(context.activeProjectId);
    return { ready: true, context, current: response?.data || response || {}, projectId: context.activeProjectId };
  }

  if (!request.customerReference) {
    return { ready: false, question: 'Decime el nombre del cliente o del trabajo para ubicar la cotización. No necesitás saber el número.' };
  }

  const customerResult = await resolveCustomerByName(request.customerReference);
  if (!customerResult.ready) return customerResult;
  const customer = customerResult.customer;
  const customerId = String(customer?.customerId || customer?.id || '').trim();
  const payload = await listQuotations();
  let candidates = normalizeQuotationRows(payload).filter(row => customerIdOfQuotation(row) === customerId && quotationStatus(row) === 'draft');

  if (!candidates.length) {
    return { ready: false, question: `Encontré a ${customer?.name || customer?.companyName || request.customerReference}, pero no tiene una cotización en borrador que pueda modificar.` };
  }

  if (request.anchorReference) {
    const anchored = candidates.filter(row => hasItemReference(row, request.anchorReference));
    if (anchored.length === 1) candidates = anchored;
    else if (anchored.length > 1) candidates = anchored;
  }

  if (candidates.length > 1 && context.activeProjectId) {
    const active = candidates.find(row => projectIdOfQuotation(row) === String(context.activeProjectId));
    if (active) candidates = [active];
  }

  if (candidates.length > 1) {
    const descriptions = candidates.slice(0, 5).map(row => {
      const labels = businessItems(quotationItems(row)).slice(0, 2).map(itemLabel).filter(Boolean);
      return labels.length ? labels.join(' + ') : 'cotización sin descripción clara';
    });
    return {
      ready: false,
      question: `Encontré más de una cotización en borrador de ${customer?.name || request.customerReference}: ${descriptions.join(' / ')}. Decime cuál trabajo querés modificar; no necesitás darme ningún número.`
    };
  }

  const row = candidates[0];
  const projectId = projectIdOfQuotation(row);
  if (!projectId) return { ready: false, question: 'Encontré la cotización por cliente, pero no pude resolver su proyecto interno. No hice cambios.' };
  const response = await getQuotation(projectId);
  return { ready: true, context, customer, current: response?.data || response || {}, projectId };
}

function findAnchorIndex(items, reference) {
  const rows = (Array.isArray(items) ? items : []).map((item, index) => ({ item, index }))
    .filter(({ item }) => normalize(item?.source) !== 'logistics_library');
  if (!reference) return rows.length ? rows[rows.length - 1].index : -1;
  const wanted = normalize(reference);
  const matches = rows.filter(({ item }) => {
    const label = normalize(`${item?.title || ''} ${item?.description || ''}`);
    return label.includes(wanted) || wanted.includes(label);
  });
  if (matches.length === 1) return matches[0].index;
  if (!matches.length) return -1;
  return -2;
}

function recomputePaymentTerms(paymentTerms, total) {
  const terms = paymentTerms && typeof paymentTerms === 'object' ? { ...paymentTerms } : {};
  const depositPercent = Number(terms.depositPercent ?? 60);
  const balancePercent = Number(terms.balancePercent ?? (100 - depositPercent));
  return {
    ...terms,
    depositPercent,
    balancePercent,
    depositUsd: Number((total * depositPercent / 100).toFixed(2)),
    balanceUsd: Number((total * balancePercent / 100).toFixed(2))
  };
}

async function addItemByHumanReference(request) {
  const resolved = await resolveQuotationForHumanReference(request);
  if (!resolved.ready) return { handled: true, outputText: resolved.question, status: 'clarification_required' };

  const current = resolved.current || {};
  if (normalize(current.status) !== 'draft') {
    return { handled: true, outputText: 'La cotización encontrada ya no está en borrador. No la modificaré sin un flujo de revisión.', status: 'blocked' };
  }

  const envelope = current.quotation_document || current.quotationDocument || {};
  const publicDocument = envelope.publicDocument || {};
  const items = clone(publicDocument.items, []);
  const anchorIndex = findAnchorIndex(items, request.anchorReference);
  if (anchorIndex === -2) {
    return { handled: true, outputText: `Encontré más de un ítem parecido a “${request.anchorReference}”. Decime cuál por su nombre para colocar el nuevo ítem en el lugar correcto.`, status: 'clarification_required' };
  }
  if (request.anchorReference && anchorIndex < 0) {
    const names = businessItems(items).map(itemLabel).filter(Boolean);
    return { handled: true, outputText: `No encontré el ítem “${request.anchorReference}”. En esa cotización tengo: ${names.join(', ')}. Decime después de cuál querés agregarlo.`, status: 'clarification_required' };
  }

  const pricingResponse = await resolveCatalogPricing({
    query: request.productQuery,
    width: request.width,
    height: request.height,
    quantity: request.quantity || 1
  });
  const pricing = pricingResponse?.data || pricingResponse || {};
  if (pricing.status === 'NOT_FOUND') {
    return { handled: true, outputText: `No encontré “${request.productQuery}” en la lista de precios autorizada. No voy a inventar el precio.`, status: 'price_required' };
  }
  if (pricing.status === 'MULTIPLE') {
    const names = (pricing.matches || []).slice(0, 5).map(item => item?.name).filter(Boolean);
    return { handled: true, outputText: `Encontré varias opciones autorizadas para “${request.productQuery}”: ${names.join(', ')}. Decime cuál corresponde.`, status: 'clarification_required' };
  }
  if (pricing.status === 'REQUIRES_INPUT') {
    return { handled: true, outputText: `Encontré el producto, pero la lista autorizada necesita otra medida o dato para calcular “${request.productQuery}”.`, status: 'price_required' };
  }
  if (pricing.status !== 'FOUND' || !pricing.item || !pricing.calculation) {
    return { handled: true, outputText: `El producto “${request.productQuery}” no tiene un precio de venta vigente en la lista autorizada. No hice cambios.`, status: 'price_required' };
  }

  const catalogItem = pricing.item;
  const calculation = pricing.calculation;
  const currency = String(calculation.currency || 'USD').toUpperCase();
  if (currency !== 'USD') {
    return { handled: true, outputText: `El precio autorizado de “${catalogItem.name || request.productQuery}” está en ${currency}. No voy a inventar un tipo de cambio para esta cotización.`, status: 'price_required' };
  }

  const subtotal = Number(calculation.subtotal || 0);
  const quantity = Number(calculation.billableUnits || request.quantity || 1);
  if (!Number.isFinite(subtotal) || subtotal <= 0 || !Number.isFinite(quantity) || quantity <= 0) {
    return { handled: true, outputText: 'Encontré el producto, pero el cálculo autorizado no devolvió un precio válido. No hice cambios.', status: 'price_required' };
  }

  const unitPrice = Number((subtotal / quantity).toFixed(2));
  const newItem = {
    itemId: catalogItem.id || `CAT-${randomUUID()}`,
    ...(catalogItem.id ? { catalogItemId: catalogItem.id } : {}),
    code: catalogItem.code || 'CATALOG',
    title: catalogItem.name || request.productQuery,
    description: request.requestedDescription || catalogItem.description || request.productQuery,
    quantity,
    unit: catalogItem.unit || 'servicio',
    unitPriceUsd: unitPrice,
    subtotalUsd: subtotal,
    source: 'MASTER_CATALOG'
  };

  const insertAt = anchorIndex >= 0 ? anchorIndex + 1 : items.length;
  items.splice(insertAt, 0, newItem);

  const total = Number(items.reduce((sum, item) => {
    const itemSubtotal = Number(item?.subtotalUsd);
    if (Number.isFinite(itemSubtotal)) return sum + itemSubtotal;
    const itemQty = Math.max(1, Number(item?.quantity) || 1);
    const itemUnitPrice = Number(item?.unitPriceUsd || 0);
    return sum + (itemQty * itemUnitPrice);
  }, 0).toFixed(2));

  const paymentTerms = recomputePaymentTerms(publicDocument.paymentTerms, total);
  const pricingTotals = {
    ...clone(publicDocument.totals, {}),
    subtotalUsd: total,
    discountUsd: Number(publicDocument?.totals?.discountUsd || 0),
    taxUsd: Number(publicDocument?.totals?.taxUsd || 0),
    totalUsd: total
  };

  const document = {
    quotation: {
      quotationNumber: current.quotationNumber,
      status: current.status || 'draft',
      source: { type: 'manual', sourceId: `OWNER-ITEM-${randomUUID()}`, channel: 'owner-whatsapp' }
    },
    project: {
      title: publicDocument?.project?.title || itemLabel(items[0]) || 'Proyecto visual',
      status: publicDocument?.project?.status || 'pending_activation',
      currentStage: publicDocument?.project?.currentStage || 'quotation'
    },
    relations: {
      customerId: current.customerId || publicDocument?.customer?.customerId,
      executiveId: current.executiveId || publicDocument?.advisor?.executiveId
    },
    customerSnapshot: clone(publicDocument.customer, {}),
    executiveSnapshot: clone(publicDocument.advisor, {}),
    items,
    pricing: pricingTotals,
    paymentTerms,
    paymentAccountsSnapshot: clone(publicDocument.paymentAccountsSnapshot, []),
    brandSnapshot: clone(publicDocument.brandSnapshot, {}),
    template: clone(publicDocument.template, {}),
    contractVersion: envelope.schemaVersion || '1.0.0'
  };

  const updatedResponse = await updateQuotation(resolved.projectId, document);
  const updated = updatedResponse?.data || updatedResponse || {};
  const customerName = publicDocument?.customer?.name || publicDocument?.customer?.companyName || resolved.customer?.name || request.customerReference || 'cliente activo';

  await updateContext({
    activeCustomerId: current.customerId || publicDocument?.customer?.customerId || resolved.customer?.customerId || resolved.customer?.id,
    activeQuotationId: updated.quotationId || current.quotationId || current.id,
    activeQuotationNumber: updated.quotationNumber || current.quotationNumber,
    activeQuotationPublicUrl: updated.publicUrl || current.publicUrl,
    activeProjectId: updated.projectId || resolved.projectId,
    lastQuotationTotalUsd: total,
    lastEntityType: 'quotation',
    lastEntityId: updated.quotationId || current.quotationId || current.id
  });

  return {
    handled: true,
    status: 'completed',
    result: updated,
    outputText: [
      `✅ Agregué “${newItem.description}” a la cotización de ${customerName}.`,
      request.anchorReference ? `Ubicación: después de “${request.anchorReference}”.` : '',
      `Precio autorizado: USD ${subtotal.toFixed(2)}`,
      `Total actualizado: USD ${total.toFixed(2)}`,
      updated.publicUrl || current.publicUrl ? `Enlace: ${updated.publicUrl || current.publicUrl}` : '',
      'La misma cotización fue actualizada; no se creó ningún duplicado.'
    ].filter(Boolean).join('\n')
  };
}

async function processOwnerQuotationMediaMessage({ message, metadata = {}, externalUserId, phone, fetchImpl = fetch }) {
  const identity = { externalUserId, phone };
  const incomingImage = imageMedia(metadata);
  const pending = readPendingMedia(identity);
  const intent = mediaIntent(message, { hasMediaContext: Boolean(incomingImage || pending) });

  if (incomingImage && !intent) {
    savePendingMedia(identity, incomingImage);
    return {
      handled: true,
      outputText: '✅ Imagen recibida. Decime “ELAN agregá esta imagen a la cotización” y la colocaré en la cotización activa.',
      status: 'image_pending'
    };
  }

  if (!intent) {
    const addItemRequest = parseAddQuotationItemRequest(message);
    if (addItemRequest) {
      try {
        return await addItemByHumanReference(addItemRequest);
      } catch (error) {
        return {
          handled: true,
          outputText: [
            'No pude agregar el nuevo ítem a la cotización.',
            `Error: ${error?.code || 'QUOTATION_ITEM_ADD_FAILED'}`,
            error?.message ? `Detalle: ${error.message}` : '',
            'No se creó ninguna cotización nueva.'
          ].filter(Boolean).join('\n'),
          status: 'failed'
        };
      }
    }
    return { handled: false };
  }

  const context = await readContext();
  if (!context.activeProjectId || !context.activeQuotationId) {
    if (incomingImage) savePendingMedia(identity, incomingImage);
    return {
      handled: true,
      outputText: 'No tengo una cotización activa para modificar. Decime el nombre del cliente o del trabajo y la ubicaré; no necesitás saber el número.',
      status: 'quotation_required'
    };
  }

  if (intent.action === 'remove') {
    const result = await removeQuotationImage(context.activeProjectId, {});
    const data = result?.data || result || {};
    clearPendingMedia(identity);
    return {
      handled: true,
      outputText: [
        '✅ Imagen quitada de la cotización activa.',
        `Cotización: ${data.quotationNumber || context.activeQuotationNumber || context.activeQuotationId}`,
        data.publicUrl ? `Enlace: ${data.publicUrl}` : ''
      ].filter(Boolean).join('\n'),
      status: 'completed',
      result: data
    };
  }

  const media = incomingImage || pending;
  if (!media) {
    return {
      handled: true,
      outputText: 'Enviame primero la imagen por WhatsApp y después decime “ELAN agregá esta imagen a la cotización”.',
      status: 'image_required'
    };
  }

  try {
    const currentResponse = await getQuotation(context.activeProjectId);
    const current = currentResponse?.data || currentResponse || {};
    if (String(current.status || '').toLowerCase() !== 'draft') {
      return {
        handled: true,
        outputText: `La cotización ${quoteNumber(current, context)} ya no está en borrador. No cambiaré su imagen sin un flujo de revisión.`,
        status: 'blocked'
      };
    }

    const downloaded = await downloadImage(media, fetchImpl);
    const uploadedResponse = await uploadQuotationImage(context.activeProjectId, {
      imageBase64: downloaded.buffer.toString('base64'),
      mimeType: downloaded.mimeType,
      filename: media.filename || 'imagen',
      mode: intent.mode || 'replace'
    });
    const data = uploadedResponse?.data || uploadedResponse || {};
    clearPendingMedia(identity);
    await updateContext({
      activeQuotationId: data.quotationId || context.activeQuotationId,
      activeQuotationNumber: data.quotationNumber || context.activeQuotationNumber,
      activeQuotationPublicUrl: data.publicUrl || context.activeQuotationPublicUrl,
      activeProjectId: data.projectId || context.activeProjectId,
      lastEntityType: 'quotation',
      lastEntityId: data.quotationId || context.activeQuotationId
    });

    return {
      handled: true,
      outputText: [
        '✅ Imagen agregada a la cotización activa.',
        `Cotización: ${data.quotationNumber || context.activeQuotationNumber || context.activeQuotationId}`,
        data.publicUrl ? `Enlace: ${data.publicUrl}` : '',
        'La misma cotización fue actualizada; no se creó ningún duplicado.'
      ].filter(Boolean).join('\n'),
      status: 'completed',
      result: data
    };
  } catch (error) {
    const code = error?.code || 'QUOTATION_IMAGE_FAILED';
    if (code === 'QUOTATION_ITEM_AMBIGUOUS') {
      return {
        handled: true,
        outputText: 'La cotización tiene varios productos. Indicame a cuál ítem querés agregar la imagen por su nombre, por ejemplo “al centro de mesa”.',
        status: 'clarification_required'
      };
    }
    return {
      handled: true,
      outputText: [
        'No pude agregar la imagen a la cotización.',
        `Error: ${code}`,
        error?.message ? `Detalle: ${error.message}` : '',
        'La cotización no fue duplicada.'
      ].filter(Boolean).join('\n'),
      status: 'failed'
    };
  }
}

module.exports = {
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  addItemByHumanReference,
  clearPendingMedia,
  downloadImage,
  imageMedia,
  mediaIntent,
  parseAddQuotationItemRequest,
  parseAnchorReference,
  parseCustomerReference,
  processOwnerQuotationMediaMessage,
  readPendingMedia,
  resolveQuotationForHumanReference,
  savePendingMedia,
  safeWahaUrl
};
