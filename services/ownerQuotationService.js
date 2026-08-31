'use strict';

const { randomUUID } = require('node:crypto');
const {
  createQuotation,
  getQuotation,
  listLogisticsRules,
  resolveCatalogPricing,
  searchCustomers,
  updateQuotation
} = require('./ownerBusinessConnectClient');
const { readContext, updateContext } = require('./ownerBusinessContextService');
const { createPendingOperation, formatPendingOperation } = require('./ownerOpsConfirmationService');
const { buildLogisticsRequest, DELIVERY_METHODS } = require('./quotationRequirementResolver');
const { computeRoadRoute } = require('./ownerRoutingService');

function trace(stage, metadata = {}) {
  try {
    console.log('[OWNER_QUOTATION]', JSON.stringify({
      ts: new Date().toISOString(),
      stage,
      ...metadata
    }));
  } catch {
    console.log('[OWNER_QUOTATION]', stage);
  }
}

function errorDetails(error) {
  const data = error?.data || error?.response?.data || error?.body || null;
  return {
    name: error?.name || 'Error',
    message: error?.message || 'Unknown error',
    code: error?.code || data?.code || data?.error?.code || null,
    status: error?.status || error?.statusCode || error?.response?.status || null
  };
}

function visibleQuotationError(error) {
  const details = errorDetails(error);
  const suffix = [details.code, details.status ? `HTTP ${details.status}` : null].filter(Boolean).join(' · ');
  return [
    'No pude guardar la cotización oficial en CONNECT/VQS.',
    suffix ? `Error: ${suffix}` : '',
    details.message ? `Detalle: ${details.message}` : '',
    'No se duplicó ninguna cotización.'
  ].filter(Boolean).join('\n');
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function parseDimensions(message) {
  const match = normalize(message).match(/\b(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\b/);
  if (!match) return {};
  return {
    width: Number(match[1].replace(',', '.')),
    height: Number(match[2].replace(',', '.'))
  };
}

function parseQuantity(message) {
  const match = normalize(message).match(/\b(?:cantidad|cant|qty)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\b/);
  return match ? Number(match[1].replace(',', '.')) : 1;
}

function parseCarrier(message) {
  const raw = String(message || '');
  const match = raw.match(/\b(?:por|via|vía)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ ]{1,50}?)\s+(?:a|hacia)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ ]+?)(?=[,.]|$)/i);
  if (!match) return {};
  return { carrier: match[1].trim(), destination: match[2].trim() };
}

function parseDestination(message) {
  const raw = String(message || '');
  const match = raw.match(/\b(?:instalad[oa]|instalacion|instalación|delivery|entrega|entregar|enviar)\s+(?:en|a|hacia)\s+([^,.\n]+?)(?=\s+(?:precio|por)\b|\s+condiciones?\b|[,.\n]|$)/i);
  return match ? match[1].trim() : '';
}

function hasLogisticsIntent(message) {
  return /\b(instalad[oa]|instalacion|instalación|delivery|entrega|entregar|enviar|envio|envío|retiro|recoger|transport(?:e|ar)|cargo\s*trans)\b/i.test(String(message || ''));
}

function parseExplicitPrice(message) {
  const raw = String(message || '');
  const patterns = [
    /\b(?:precio|total)\s*[:=]?\s*(us\$|usd|c\$|nio|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(dolares|dólares|usd|cordobas|córdobas|nio)?\b/i,
    /\bpor\s+(us\$|usd|c\$|nio|\$)\s*([0-9]+(?:[.,][0-9]{1,2})?)\b/i,
    /\bpor\s+([0-9]+(?:[.,][0-9]{1,2})?)\s*(dolares|dólares|usd|cordobas|córdobas|nio)\b/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const amountToken = match[2] && /\d/.test(match[2]) ? match[2] : match[1];
    const amount = Number(String(amountToken).replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const currencyText = normalize([match[1], match[3], match[2]].join(' '));
    const currency = /(?:c\$|nio|cordoba)/i.test(currencyText) ? 'NIO' : 'USD';
    return { amount, currency };
  }
  return null;
}

function parseEditPrice(message) {
  const raw = String(message || '');
  const match = raw.match(/\b(?:precio|total)\s*(?:a|por|en|:|=)?\s*(us\$|usd|c\$|nio|\$)?\s*([0-9]+(?:[.,][0-9]{1,2})?)\s*(dolares|dólares|usd|cordobas|córdobas|nio)?\b/i);
  if (!match) return null;
  const amount = Number(String(match[2]).replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const currencyText = normalize([match[1], match[3]].join(' '));
  return {
    amount,
    currency: /(?:c\$|nio|cordoba)/i.test(currencyText) ? 'NIO' : 'USD'
  };
}

function parsePaymentTerms(message) {
  const raw = String(message || '');
  const split = raw.match(/\b(\d{1,3})\s*%?\s*[/\\-]\s*(\d{1,3})\s*%?\b/);
  if (split) {
    const depositPercent = Number(split[1]);
    const balancePercent = Number(split[2]);
    if (depositPercent > 0 && balancePercent >= 0 && depositPercent + balancePercent === 100) return { depositPercent, balancePercent };
  }
  const deposit = raw.match(/\b(?:anticipo|inicial|adelanto)\s*(?:de)?\s*(\d{1,3})\s*%/i);
  if (deposit) {
    const depositPercent = Number(deposit[1]);
    if (depositPercent > 0 && depositPercent <= 100) return { depositPercent, balancePercent: 100 - depositPercent };
  }
  return { depositPercent: 60, balancePercent: 40 };
}

function parseQuotationSendFollowup(message) {
  const text = normalize(message).replace(/^elan[\s,;:]+/, '').replace(/[.!?]+$/g, '').trim();
  if (/^(mandasela|enviasela|mandala|enviala)$/.test(text)) return true;
  return /^(manda|mandale|envia|enviale|comparte|compartile)\s+(?:esa\s+|la\s+)?cotizacion(?:\s+al\s+cliente)?$/.test(text);
}

function parseProductQuery(message) {
  let value = String(message || '').trim();
  value = value.replace(/^(?:elan[, ]+)?(?:cotízame|cotizame|realiza una cotización|realiza una cotizacion|cotizar|cotiza)\b\s*/i, '');
  value = value.replace(/^para\s+(?:(?:la|el)\s+)?(?:dra\.?|dr\.?|sra\.?|sr\.?)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ .'-]+?\s+(?=(?:un|una|el|la)\s+)/i, '');
  value = value.replace(/\b(?:cantidad|cant|qty)\s*[:=]?\s*\d+(?:[.,]\d+)?\b/gi, '');
  value = value.replace(/\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:m|mts|metros|cm)?\b/gi, '');
  value = value.replace(/\b(?:instalad[oa]|instalacion|instalación|delivery|entrega|entregar|enviar)\b.*$/i, '');
  value = value.replace(/\b(?:precio|total)\s*[:=]?.*$/i, '');
  value = value.replace(/\bcondiciones?(?:\s+de\s+pago)?\b.*$/i, '');
  value = value.replace(/\b(?:con|sin)\s+(?:instalacion|instalación|delivery)\b.*$/i, '');
  return value.replace(/\s+/g, ' ').replace(/^[,:;-]+|[,:;-]+$/g, '').trim();
}

function parseEditDescription(message) {
  const raw = String(message || '').trim();
  const patterns = [
    /\b(?:descripcion|descripción|concepto|detalle)\s*(?:de\s+(?:la\s+)?cotizacion|de\s+(?:la\s+)?cotización)?\s*(?:a|por|:|=)\s*["“]?(.+?)["”]?(?=\s+(?:y\s+)?(?:cambia|cambiar|modifica|modificar|corrige|corregir|precio|total)\b|$)/i,
    /\b(?:cambia|cambiar|modifica|modificar|corrige|corregir|actualiza|actualizar)\s+(?:la\s+)?(?:descripcion|descripción|concepto|detalle)\s+(?:a|por)\s*["“]?(.+?)["”]?(?=\s+(?:y\s+)?(?:precio|total)\b|$)/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (!match) continue;
    const description = String(match[1] || '').replace(/[.!?]+$/g, '').trim();
    if (description) return description;
  }
  return '';
}

function parseQuotationSplitRequest(message) {
  const normalized = normalize(message)
    .replace(/^elan[\s,;:]+/, '')
    .replace(/[.!?]+$/g, '')
    .trim();

  if (!/\bcotizacion\b/.test(normalized)) return null;
  if (!/\b(divide|dividir|dividila|separa|separar|separala|separame)\b/.test(normalized)) return null;

  const perItem = /\b(cada\s+(?:item|items)|una\s+por\s+(?:cada\s+)?(?:item|items)|por\s+(?:item|items))\b/.test(normalized);
  const inTwo = /\b(en\s+dos|dos\s+cotizaciones)\b/.test(normalized);
  if (!perItem && !inTwo) return null;

  return {
    splitActive: true,
    splitMode: perItem ? 'per_item' : 'two',
    requestedParts: inTwo ? 2 : null,
    message: String(message || '').trim()
  };
}

function parseQuotationEditRequest(message) {
  const normalized = normalize(message).replace(/^elan[\s,;:]+/, '').trim();
  const editVerb = /\b(corrige|corregir|cambia|cambiar|modifica|modificar|actualiza|actualizar|ajusta|ajustar)\b/.test(normalized);
  const quotationReference = /\b(cotizacion|cotización|precio|descripcion|descripción|concepto|detalle|total)\b/.test(normalized);
  if (!editVerb || !quotationReference) return null;

  const description = parseEditDescription(message);
  const price = parseEditPrice(message);
  const paymentTermsMatch = String(message || '').match(/\b\d{1,3}\s*%?\s*[/\\-]\s*\d{1,3}\s*%?\b|\b(?:anticipo|inicial|adelanto)\b/i);
  const paymentTerms = paymentTermsMatch ? parsePaymentTerms(message) : null;

  if (!description && !price && !paymentTerms) return null;
  return {
    editActive: true,
    message: String(message || '').trim(),
    description: description || undefined,
    price: price || undefined,
    paymentTerms: paymentTerms || undefined
  };
}

function parseQuotationRequest(message) {
  if (parseQuotationSendFollowup(message)) return { sendActive: true, message: String(message || '').trim() };

  const split = parseQuotationSplitRequest(message);
  if (split) return split;

  const edit = parseQuotationEditRequest(message);
  if (edit) return edit;

  const normalized = normalize(message);
  if (!/^(?:elan\s+)?(?:cotizame|cotiza|cotizar|realiza una cotizacion)\b/.test(normalized)) return null;
  const dimensions = parseDimensions(message);
  const carrier = parseCarrier(message);
  const destination = carrier.destination || parseDestination(message);
  const productQuery = parseProductQuery(message);
  const explicitPrice = parseExplicitPrice(message);
  const paymentTerms = parsePaymentTerms(message);
  if (!productQuery) return null;
  const parsed = {
    message: String(message || '').trim(),
    productQuery,
    width: dimensions.width,
    height: dimensions.height,
    quantity: parseQuantity(message),
    destination: destination || undefined,
    carrier: carrier.carrier || (/cargo\s*trans/i.test(message) ? 'Cargo Trans' : undefined),
    explicitPrice: explicitPrice || undefined,
    paymentTerms,
    logisticsRequested: hasLogisticsIntent(message),
    priceIncludesLogistics: Boolean(explicitPrice && /\b(instalad[oa]|entregad[oa]|delivery incluido|incluye instalacion|incluye instalación)\b/i.test(message))
  };
  trace('parsed', {
    productQuery: parsed.productQuery,
    explicitPrice: parsed.explicitPrice || null,
    paymentTerms: parsed.paymentTerms,
    logisticsRequested: parsed.logisticsRequested
  });
  return parsed;
}

function matchesText(left, right) {
  if (!left || !right) return true;
  const a = normalize(left);
  const b = normalize(right);
  return a === b || a.includes(b) || b.includes(a);
}

function selectLogisticsRule(rules, logistics) {
  const rows = Array.isArray(rules) ? rules : [];
  if (logistics.method === DELIVERY_METHODS.CARRIER) {
    return rows.find(rule => rule.serviceType === 'carrier' && matchesText(rule.provider, logistics.carrier) && matchesText(rule.destination, logistics.destination)) || null;
  }
  if (logistics.method === DELIVERY_METHODS.DELIVERY) return rows.find(rule => rule.serviceType === 'delivery' && matchesText(rule.destination, logistics.destination)) || null;
  return null;
}

function selectDistanceRule(rules) {
  return (Array.isArray(rules) ? rules : []).find(rule => rule.serviceType === 'distance' && rule.pricingUnit === 'per_km') || null;
}

async function resolveLogistics(input) {
  if (input.explicitPrice && input.priceIncludesLogistics) {
    return {
      ready: true,
      amount: 0,
      currency: input.explicitPrice.currency,
      description: input.destination ? `Precio Owner incluye instalación/entrega en ${input.destination}` : 'Precio Owner incluye logística indicada',
      details: { includedInOwnerPrice: true, destination: input.destination || null }
    };
  }

  if (input.explicitPrice && !input.logisticsRequested) {
    return {
      ready: true,
      amount: 0,
      currency: input.explicitPrice.currency,
      description: '',
      details: { fixedOwnerPrice: true, logisticsRequested: false }
    };
  }

  const request = buildLogisticsRequest({ text: input.message, width: input.width, height: input.height, quantity: input.quantity, destination: input.destination, carrier: input.carrier });
  if (!request.ready) return { ready: false, question: request.question, requirements: request.requirements };
  const logistics = request.logistics;
  if (logistics.method === DELIVERY_METHODS.PICKUP || !logistics.method) return { ready: true, amount: 0, currency: input.explicitPrice?.currency || 'USD', description: 'Retiro / sin logística adicional', details: logistics };

  const response = await listLogisticsRules({});
  const rules = response.data || [];
  const directRule = selectLogisticsRule(rules, logistics);
  if (directRule) {
    if (directRule.pricingUnit !== 'flat') return { ready: false, question: `La regla ${directRule.ruleCode || ''} requiere una unidad logística adicional antes de cotizar.`.trim() };
    return { ready: true, amount: Number(directRule.rate), currency: directRule.currency, description: directRule.provider ? `${directRule.provider}: ${directRule.origin || ''} → ${directRule.destination || ''}` : `Delivery ${directRule.destination || ''}`, ruleId: directRule.id, ruleCode: directRule.ruleCode, details: logistics };
  }
  if (logistics.method === DELIVERY_METHODS.CARRIER) return { ready: false, question: `No tengo una tarifa vigente de ${logistics.carrier || 'ese transportista'} para ${logistics.destination || 'ese destino'}. Podés indicármela por mensaje para registrarla.` };

  const route = await computeRoadRoute(logistics.coordinates || logistics.destination);
  const distanceRule = selectDistanceRule(rules);
  if (!distanceRule) return { ready: false, question: `Tengo la ruta (${route.oneWayKm.toFixed(2)} km por trayecto), pero no hay una tarifa por km vigente en la biblioteca logística.` };
  const roundTripKm = Number((route.oneWayKm * 2 * Math.max(1, Number(logistics.trips) || 1)).toFixed(2));
  const amount = Number((roundTripKm * Number(distanceRule.rate)).toFixed(2));
  return { ready: true, amount, currency: distanceRule.currency, description: `Logística por carretera: ${roundTripKm.toFixed(2)} km facturables`, ruleId: distanceRule.id, ruleCode: distanceRule.ruleCode, route: { ...route, roundTripKm }, details: logistics };
}

async function resolveActiveCustomer() {
  const context = await readContext();
  trace('customer-context', { activeCustomerId: context.activeCustomerId || null });
  if (!context.activeCustomerId) return { ready: false, question: '¿Para qué cliente preparo la cotización? Primero indicame o buscá el cliente.' };
  const result = await searchCustomers(context.activeCustomerId);
  const rows = result?.data?.results || [];
  const match = rows.find(row => String(row?.customer?.customerId || row?.customer?.id || row?.sourceId || '') === String(context.activeCustomerId)) || rows[0];
  if (!match) return { ready: false, question: 'No pude resolver el cliente activo en el directorio oficial. Indicame nuevamente el cliente.' };
  const customer = match.customer || match;
  trace('customer-resolved', {
    customerId: customer.customerId || customer.id || null,
    phone: customer.phone || null
  });
  return { ready: true, customer };
}

function money(amount, currency) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

function formalQuoteBlockForPricing(pricing = {}, explicitPrice = null) {
  if (explicitPrice) return null;
  if (String(pricing?.status || '').toUpperCase() !== 'BASE_PRICE_ONLY') return null;
  const itemName = String(pricing?.item?.name || pricing?.query || 'este producto').trim();
  const minimum = Number(pricing?.item?.minimumPrice);
  const currency = String(pricing?.item?.currency || 'USD').trim().toUpperCase();
  return {
    ready: false,
    blocked: true,
    code: 'FORMAL_QUOTATION_FROM_PRICE_NOT_ALLOWED',
    question: [
      `“${itemName}” tiene una tarifa DESDE y no puede generar una cotización formal automática.`,
      Number.isFinite(minimum) && minimum > 0 ? `Referencia mínima: ${currency} ${minimum.toFixed(2)}.` : '',
      'La tarifa DESDE solo puede mostrarse como referencia. Para una cotización formal se necesita un precio final distinto y autorizado.'
    ].filter(Boolean).join('\n')
  };
}

async function prepareActiveQuotationDelivery() {
  const context = await readContext();
  if (!context.activeProjectId || !context.activeQuotationId) {
    return { ready: false, question: 'No tengo una cotización activa en esta conversación para enviar. Primero creá o buscá la cotización.' };
  }
  const operation = await createPendingOperation({
    capability: 'business.quotation.send-whatsapp',
    target: 'connect',
    requestedBy: 'owner-whatsapp',
    summary: `Enviar ${context.activeQuotationNumber || context.activeQuotationId} al cliente por WhatsApp`,
    impact: 'Envía externamente la cotización oficial activa. Requiere confirmación explícita del Owner.',
    parameters: { projectId: context.activeProjectId, delivery: {} }
  });
  return { ready: false, question: formatPendingOperation(operation), operation, sendPending: true };
}

function clone(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return JSON.parse(JSON.stringify(value));
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

function splitItemSubtotal(item) {
  const direct = Number(item?.subtotalUsd ?? item?.subtotal);
  if (Number.isFinite(direct) && direct >= 0) return Number(direct.toFixed(2));
  const quantity = Math.max(1, Number(item?.quantity) || 1);
  const unitPrice = Number(item?.unitPriceUsd ?? item?.unitPrice ?? 0);
  return Number((quantity * unitPrice).toFixed(2));
}

function splitPricing(originalTotals, total) {
  const totals = clone(originalTotals, {});
  const exchangeRate = Number(totals.exchangeRate || 0);
  const payableTotalNio = exchangeRate > 0 ? Number((total * exchangeRate).toFixed(2)) : 0;

  return {
    ...totals,
    subtotalGross: total,
    subtotalUsd: total,
    subtotal: total,
    discountUsd: 0,
    discount: 0,
    taxUsd: 0,
    tax: 0,
    totalUsd: total,
    total,
    payableTotalNio,
    convertedTotal: payableTotalNio
  };
}

function splitPaymentTerms(originalTerms, total, payableTotalNio) {
  const terms = clone(originalTerms, {});
  if (Array.isArray(terms.installments) && terms.installments.length) {
    terms.installments = terms.installments.map((installment, index) => {
      const percentage = Number(installment?.percentage ?? installment?.percent ?? 0);
      const amountUsd = Number((total * percentage / 100).toFixed(2));
      const amountNio = Number((payableTotalNio * percentage / 100).toFixed(2));
      return {
        ...installment,
        id: installment?.id || `installment-${index + 1}`,
        percentage,
        amountUsd,
        amountNio
      };
    });
    return terms;
  }

  return recomputePaymentTerms(terms, total);
}

function buildSplitQuotationDocument({
  current,
  publicDocument,
  item,
  partIndex,
  partCount,
  splitGroupId
}) {
  const total = splitItemSubtotal(item);
  const pricing = splitPricing(publicDocument.totals, total);
  const baseTitle = String(publicDocument.project?.title || 'Proyecto visual').trim();
  const itemTitle = String(item?.title || item?.description || `Alternativa ${partIndex}`).trim();
  const paymentTerms = splitPaymentTerms(publicDocument.paymentTerms, total, Number(pricing.payableTotalNio || 0));

  return {
    quotation: {
      status: 'draft',
      source: {
        type: 'manual',
        sourceId: `OWNER-SPLIT-${splitGroupId}-${partIndex}`,
        channel: 'owner-whatsapp'
      }
    },
    project: {
      title: `${baseTitle} — Alternativa ${partIndex}: ${itemTitle}`,
      status: 'pending_activation',
      currentStage: 'quotation'
    },
    relations: {
      customerId: current.customerId || publicDocument.customer?.customerId,
      executiveId: current.executiveId || publicDocument.advisor?.executiveId,
      splitGroupId,
      splitFromQuotationId: current.quotationId,
      splitFromProjectId: current.projectId,
      splitFromQuotationNumber: current.quotationNumber,
      splitPartIndex: partIndex,
      splitPartCount: partCount,
      commercialProjectTitle: baseTitle
    },
    customerSnapshot: clone(publicDocument.customer, {}),
    executiveSnapshot: clone(publicDocument.advisor, {}),
    items: [clone(item, {})],
    pricing,
    paymentTerms,
    paymentAccountsSnapshot: clone(publicDocument.paymentAccountsSnapshot, []),
    brandSnapshot: clone(publicDocument.brandSnapshot, {}),
    template: clone(publicDocument.template, {}),
    contractVersion: current.quotation_document?.schemaVersion || '1.0.0'
  };
}

async function splitActiveQuotation(input) {
  const context = await readContext();
  if (!context.activeProjectId || !context.activeQuotationId) {
    return { ready: false, question: 'No tengo una cotización activa para dividir. Primero buscá la cotización que querés separar.' };
  }

  const response = await getQuotation(context.activeProjectId);
  const current = response?.data || response || {};
  if (String(current.status || '').toLowerCase() !== 'draft') {
    return {
      ready: false,
      question: `La cotización ${current.quotationNumber || context.activeQuotationNumber || ''} ya no está en borrador. No crearé alternativas derivadas sin una revisión explícita.`
    };
  }

  const envelope = current.quotation_document || {};
  const publicDocument = envelope.publicDocument || {};
  const items = clone(publicDocument.items, []);

  if (!Array.isArray(items) || items.length < 2) {
    return { ready: false, question: 'La cotización activa no tiene al menos dos ítems para dividir.' };
  }

  const logisticsItems = items.filter(item => String(item?.source || '').toUpperCase() === 'LOGISTICS_LIBRARY');
  if (logisticsItems.length) {
    return {
      ready: false,
      question: 'La cotización contiene logística separada. Antes de dividirla necesito saber a cuál alternativa se asigna ese costo para no duplicarlo.'
    };
  }

  const businessItems = items.filter(item => String(item?.source || '').toUpperCase() !== 'LOGISTICS_LIBRARY');
  if (input?.requestedParts && businessItems.length !== Number(input.requestedParts)) {
    return {
      ready: false,
      question: `Pediste dividirla en ${input.requestedParts}, pero la cotización tiene ${businessItems.length} ítems comerciales. Indicame si querés una cotización por cada ítem.`
    };
  }

  const totals = publicDocument.totals || {};
  const discount = Number(totals.discountUsd ?? totals.discount ?? 0);
  const tax = Number(totals.taxUsd ?? totals.tax ?? 0);
  if (Math.abs(discount) > 0.001 || Math.abs(tax) > 0.001) {
    return {
      ready: false,
      question: 'La cotización tiene descuento o impuesto global. Necesito una regla explícita para repartirlo antes de dividirla.'
    };
  }

  const itemTotal = Number(businessItems.reduce((sum, item) => sum + splitItemSubtotal(item), 0).toFixed(2));
  const officialTotal = Number(totals.totalUsd ?? totals.total ?? current.totalUsd ?? 0);
  if (Math.abs(itemTotal - officialTotal) > 0.01) {
    return {
      ready: false,
      question: `La suma de los ítems es USD ${itemTotal.toFixed(2)}, pero el total oficial es USD ${officialTotal.toFixed(2)}. No dividiré importes que no cuadran.`
    };
  }

  const splitGroupId = randomUUID();
  const created = [];

  for (let index = 0; index < businessItems.length; index += 1) {
    const item = businessItems[index];
    const partIndex = index + 1;
    const document = buildSplitQuotationDocument({
      current,
      publicDocument,
      item,
      partIndex,
      partCount: businessItems.length,
      splitGroupId
    });
    const itemKey = String(item?.itemId || item?.id || index).trim() || String(index);
    const idempotencyKey = `owner-split-${current.quotationId}-${itemKey}`;
    const childResponse = await createQuotation(document, idempotencyKey);
    const child = childResponse?.data || childResponse || {};
    created.push(child);
  }

  trace('vqs-split-success', {
    sourceProjectId: current.projectId,
    sourceQuotationId: current.quotationId,
    sourceQuotationNumber: current.quotationNumber,
    splitGroupId,
    childCount: created.length,
    children: created.map(child => ({
      projectId: child.projectId || null,
      quotationId: child.quotationId || null,
      quotationNumber: child.quotationNumber || null,
      totalUsd: child.totalUsd || null
    }))
  });

  return {
    ready: true,
    split: true,
    sourceQuotation: current,
    splitGroupId,
    quotations: created,
    summary: [
      '✅ Cotización dividida en alternativas independientes.',
      '',
      `Origen conservado: ${current.quotationNumber || current.quotationId}`,
      `Proyecto comercial: ${publicDocument.project?.title || 'Proyecto visual'}`,
      `Cliente: ${publicDocument.customer?.name || publicDocument.customer?.companyName || 'Cliente'}`,
      '',
      ...created.flatMap((child, index) => [
        `Alternativa ${index + 1}: ${child.quotationNumber || child.quotationId}`,
        `Total: USD ${Number(child.totalUsd || splitItemSubtotal(businessItems[index])).toFixed(2)}`,
        child.publicUrl ? `Enlace: ${child.publicUrl}` : ''
      ].filter(Boolean)),
      '',
      'La cotización original quedó intacta como respaldo interno.'
    ].join('\n')
  };
}

async function editActiveQuotation(input) {
  const context = await readContext();
  if (!context.activeProjectId || !context.activeQuotationId) {
    return { ready: false, question: 'No tengo una cotización activa para corregir. Primero buscá o creá la cotización.' };
  }

  const response = await getQuotation(context.activeProjectId);
  const current = response?.data || response || {};
  if (String(current.status || '').toLowerCase() !== 'draft') {
    return { ready: false, question: `La cotización ${current.quotationNumber || context.activeQuotationNumber || ''} ya no está en borrador. No la modificaré desde WhatsApp sin un flujo de revisión.` };
  }

  const envelope = current.quotation_document || {};
  const publicDocument = envelope.publicDocument || {};
  const items = clone(publicDocument.items, []);
  if (!Array.isArray(items) || !items.length) {
    return { ready: false, question: 'La cotización activa no tiene ítems editables.' };
  }

  const businessIndexes = items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => String(item?.source || '').toUpperCase() !== 'LOGISTICS_LIBRARY')
    .map(({ index }) => index);

  if (!businessIndexes.length) return { ready: false, question: 'No encontré un ítem comercial editable en la cotización activa.' };
  if (input.price && businessIndexes.length > 1) {
    return { ready: false, question: 'La cotización tiene más de un ítem comercial. Indicame cuál precio querés modificar para no cambiar el equivocado.' };
  }

  const targetIndex = businessIndexes[0];
  const targetItem = { ...items[targetIndex] };
  let projectTitle = String(publicDocument.project?.title || targetItem.title || targetItem.description || 'Proyecto visual').trim();

  if (input.description) {
    targetItem.title = input.description;
    targetItem.description = input.description;
    projectTitle = input.description;
  }

  if (input.price) {
    if (input.price.currency !== 'USD') {
      return { ready: false, question: `El nuevo precio está en ${input.price.currency}. No voy a inventar un tipo de cambio; indicame el valor autorizado en USD.` };
    }
    const quantity = Math.max(1, Number(targetItem.quantity) || 1);
    targetItem.unitPriceUsd = Number((input.price.amount / quantity).toFixed(2));
    targetItem.subtotalUsd = Number(input.price.amount.toFixed(2));
    targetItem.source = 'OWNER_EXPLICIT_PRICE';
  }

  items[targetIndex] = targetItem;

  const total = Number(items.reduce((sum, item) => {
    const subtotal = Number(item?.subtotalUsd);
    if (Number.isFinite(subtotal)) return sum + subtotal;
    const quantity = Math.max(1, Number(item?.quantity) || 1);
    const unitPrice = Number(item?.unitPriceUsd || 0);
    return sum + (quantity * unitPrice);
  }, 0).toFixed(2));

  let paymentTerms = clone(publicDocument.paymentTerms, {});
  if (input.paymentTerms) {
    paymentTerms = {
      ...paymentTerms,
      depositPercent: input.paymentTerms.depositPercent,
      balancePercent: input.paymentTerms.balancePercent
    };
  }
  paymentTerms = recomputePaymentTerms(paymentTerms, total);

  const pricing = {
    ...clone(publicDocument.totals, {}),
    subtotalUsd: total,
    discountUsd: 0,
    taxUsd: 0,
    totalUsd: total
  };

  const document = {
    quotation: {
      quotationNumber: current.quotationNumber,
      status: current.status || 'draft',
      source: {
        type: 'manual',
        sourceId: `OWNER-EDIT-${randomUUID()}`,
        channel: 'owner-whatsapp'
      }
    },
    project: {
      title: projectTitle,
      status: 'pending_activation',
      currentStage: 'quotation'
    },
    relations: {
      customerId: current.customerId || publicDocument.customer?.customerId,
      executiveId: current.executiveId || publicDocument.advisor?.executiveId
    },
    customerSnapshot: clone(publicDocument.customer, {}),
    executiveSnapshot: clone(publicDocument.advisor, {}),
    items,
    pricing,
    paymentTerms,
    paymentAccountsSnapshot: clone(publicDocument.paymentAccountsSnapshot, []),
    brandSnapshot: clone(publicDocument.brandSnapshot, {}),
    template: clone(publicDocument.template, {}),
    contractVersion: envelope.schemaVersion || '1.0.0',
    ownerCommercialOverride: input.price ? {
      applied: true,
      amountUsd: input.price.amount,
      source: 'owner-whatsapp-edit'
    } : undefined
  };

  trace('vqs-edit-request', {
    projectId: context.activeProjectId,
    quotationId: context.activeQuotationId,
    descriptionChanged: Boolean(input.description),
    priceChanged: Boolean(input.price),
    totalUsd: total
  });

  const updatedResponse = await updateQuotation(context.activeProjectId, document);
  const updated = updatedResponse?.data || updatedResponse || {};

  await updateContext({
    activeQuotationId: updated.quotationId || context.activeQuotationId,
    activeQuotationNumber: updated.quotationNumber || context.activeQuotationNumber,
    activeQuotationPublicUrl: updated.publicUrl || context.activeQuotationPublicUrl,
    activeProjectId: updated.projectId || context.activeProjectId,
    lastQuotationTotalUsd: total,
    lastEntityType: 'quotation',
    lastEntityId: updated.quotationId || context.activeQuotationId
  });

  return {
    ready: true,
    edited: true,
    quotation: updated,
    summary: [
      '✅ Cotización corregida sin crear duplicados.',
      '',
      `Cotización: ${updated.quotationNumber || current.quotationNumber}`,
      input.description ? `Descripción: ${input.description}` : '',
      input.price ? `Nuevo precio comercial: USD ${Number(input.price.amount).toFixed(2)}` : '',
      `Total actualizado: USD ${total.toFixed(2)}`,
      `Anticipo ${paymentTerms.depositPercent}%: USD ${Number(paymentTerms.depositUsd).toFixed(2)}`,
      `Saldo ${paymentTerms.balancePercent}%: USD ${Number(paymentTerms.balanceUsd).toFixed(2)}`,
      updated.publicUrl ? `Enlace: ${updated.publicUrl}` : '',
      '',
      'Podés revisarla y después decir: “mandásela”.'
    ].filter(Boolean).join('\n')
  };
}

async function prepareAndCreateQuotation(input) {
  if (input?.sendActive === true) return prepareActiveQuotationDelivery();
  if (input?.splitActive === true) {
    try {
      return await splitActiveQuotation(input);
    } catch (error) {
      const details = errorDetails(error);
      trace('split-failed', details);
      return { ready: false, failed: true, error: details, question: visibleQuotationError(error) };
    }
  }
  if (input?.editActive === true) {
    try {
      return await editActiveQuotation(input);
    } catch (error) {
      const details = errorDetails(error);
      trace('edit-failed', details);
      return { ready: false, failed: true, error: details, question: visibleQuotationError(error) };
    }
  }

  try {
    trace('start', {
      productQuery: input?.productQuery || null,
      explicitPrice: input?.explicitPrice || null,
      paymentTerms: input?.paymentTerms || null
    });

    const customerResult = await resolveActiveCustomer();
    if (!customerResult.ready) {
      trace('blocked-customer', { question: customerResult.question || null });
      return customerResult;
    }

    const logisticsResult = await resolveLogistics(input);
    if (!logisticsResult.ready) {
      trace('blocked-logistics', { question: logisticsResult.question || null });
      return logisticsResult;
    }
    trace('logistics-resolved', { amount: logisticsResult.amount || 0, currency: logisticsResult.currency || null });

    let pricing = {};
    try {
      const pricingResponse = await resolveCatalogPricing({ query: input.productQuery, width: input.width, height: input.height, quantity: input.quantity });
      pricing = pricingResponse.data || {};
      trace('pricing-resolved', { status: pricing.status || null });
    } catch (error) {
      trace('pricing-error', errorDetails(error));
      if (!input.explicitPrice) throw error;
      pricing = { status: 'NOT_FOUND' };
    }

    const formalQuoteBlock = formalQuoteBlockForPricing(pricing, input.explicitPrice || null);
    if (formalQuoteBlock) {
      trace('blocked-from-price', {
        code: formalQuoteBlock.code,
        productQuery: input.productQuery || null,
        pricingStatus: pricing.status || null
      });
      return formalQuoteBlock;
    }

    if (!input.explicitPrice) {
      if (pricing.status === 'NOT_FOUND') return { ready: false, question: `No encontré “${input.productQuery}” en la biblioteca oficial. Necesito identificar el producto o servicio correcto antes de cotizar.` };
      if (pricing.status === 'MULTIPLE') {
        const names = (pricing.matches || []).slice(0, 5).map(item => item.name).filter(Boolean);
        return { ready: false, question: `Encontré varias opciones en la biblioteca: ${names.join(', ')}. Indicame cuál corresponde.` };
      }
      if (pricing.status === 'REQUIRES_INPUT') return { ready: false, question: 'Faltan medidas necesarias para calcular el precio de este producto.' };
      if (pricing.status !== 'FOUND') return { ready: false, question: 'El producto existe, pero no tiene un precio de venta vigente en la biblioteca oficial.' };
    }

    const explicit = input.explicitPrice || null;
    const catalogFound = pricing.status === 'FOUND' && pricing.item && pricing.calculation;
    const currency = explicit?.currency || pricing.calculation?.currency || 'USD';
    if (currency !== 'USD') return { ready: false, question: `El precio indicado está en ${currency}. El VQS oficial consolida el total principal en USD; necesito una conversión oficial antes de crear la cotización.` };

    const logisticsAmount = Number(logisticsResult.amount || 0);
    if (logisticsAmount > 0 && logisticsResult.currency !== currency) return { ready: false, question: `El precio está en ${currency} y la logística en ${logisticsResult.currency}. No voy a inventar un tipo de cambio.` };

    const baseSubtotal = explicit ? Number(explicit.amount) : Number(pricing.calculation.subtotal || 0);
    const total = Number((baseSubtotal + logisticsAmount).toFixed(2));
    const customer = customerResult.customer;
    const item = catalogFound ? pricing.item : { id: `OWNER-${randomUUID()}`, code: 'OWNER-CUSTOM', name: input.productQuery, description: input.productQuery, unit: 'servicio', unitPrice: baseSubtotal };

    const items = [{
      itemId: item.id,
      ...(catalogFound ? { catalogItemId: item.id } : {}),
      code: item.code,
      title: item.name,
      description: item.description || input.productQuery,
      quantity: explicit ? 1 : Number(pricing.calculation.billableUnits || input.quantity || 1),
      unit: item.unit || 'servicio',
      unitPriceUsd: explicit ? baseSubtotal : Number(item.unitPrice),
      subtotalUsd: baseSubtotal,
      source: explicit ? 'OWNER_EXPLICIT_PRICE' : 'MASTER_CATALOG'
    }];
    if (logisticsAmount > 0) items.push({ itemId: `LOG-${randomUUID()}`, title: logisticsResult.description || 'Logística', description: logisticsResult.description || 'Logística', quantity: 1, unit: 'servicio', unitPriceUsd: logisticsAmount, subtotalUsd: logisticsAmount, source: 'LOGISTICS_LIBRARY' });

    const terms = input.paymentTerms || { depositPercent: 60, balancePercent: 40 };
    const depositUsd = Number((total * terms.depositPercent / 100).toFixed(2));
    const balanceUsd = Number((total - depositUsd).toFixed(2));
    const document = {
      quotation: { status: 'draft', source: { type: 'owner-whatsapp', sourceId: `OWNER-${randomUUID()}` } },
      project: { title: item.name, status: 'pending_activation', currentStage: 'quotation' },
      relations: { customerId: customer.customerId || customer.id },
      customerSnapshot: { customerId: customer.customerId || customer.id, name: customer.name || customer.companyName, companyName: customer.companyName || '', phone: customer.phone || '', email: customer.email || '', address: customer.address || '', city: customer.city || '' },
      executiveSnapshot: { executiveId: 'owner-whatsapp', name: 'ELAN Owner' },
      items,
      pricing: { subtotalUsd: total, discountUsd: 0, taxUsd: 0, totalUsd: total },
      paymentTerms: { depositPercent: terms.depositPercent, balancePercent: terms.balancePercent, depositUsd, balanceUsd },
      ownerCommercialOverride: explicit ? { applied: true, amountUsd: baseSubtotal, includesLogistics: Boolean(input.priceIncludesLogistics), source: 'owner-whatsapp' } : undefined,
      contractVersion: '1.0.0'
    };

    trace('vqs-create-request', {
      customerId: customer.customerId || customer.id || null,
      totalUsd: total,
      itemCount: items.length,
      source: explicit ? 'OWNER_EXPLICIT_PRICE' : 'MASTER_CATALOG'
    });

    const createdResponse = await createQuotation(document, `owner-${randomUUID()}`);
    const created = createdResponse.data || createdResponse;
    trace('vqs-create-success', {
      quotationId: created.quotationId || null,
      quotationNumber: created.quotationNumber || null,
      projectId: created.projectId || null
    });

    await updateContext({ activeCustomerId: customer.customerId || customer.id, activeQuotationId: created.quotationId || null, activeQuotationNumber: created.quotationNumber || null, activeQuotationPublicUrl: created.publicUrl || null, activeProjectId: created.projectId || null, lastQuotationTotalUsd: total, lastEntityType: 'quotation', lastEntityId: created.quotationId || created.projectId || null });

    return {
      ready: true,
      created: true,
      quotation: created,
      summary: [
        '✅ Cotización oficial creada.', '',
        `Cliente: ${customer.name || customer.companyName}`,
        `Concepto: ${item.name}`,
        input.width && input.height ? `Medida: ${input.width} × ${input.height}` : '',
        logisticsResult.description ? `Logística: ${logisticsResult.description}` : '',
        explicit ? 'Precio: autorizado directamente por Owner' : '',
        `Total: ${money(total, currency)}`,
        `Anticipo ${terms.depositPercent}%: ${money(depositUsd, currency)}`,
        `Saldo ${terms.balancePercent}%: ${money(balanceUsd, currency)}`,
        `Cotización: ${created.quotationNumber || created.quotationId}`,
        created.publicUrl ? `Enlace: ${created.publicUrl}` : '', '',
        'Podés revisarla y luego decir: “mandásela”.'
      ].filter(Boolean).join('\n')
    };
  } catch (error) {
    const details = errorDetails(error);
    trace('failed', details);
    return {
      ready: false,
      failed: true,
      error: details,
      question: visibleQuotationError(error)
    };
  }
}

module.exports = {
  editActiveQuotation,
  errorDetails,
  formalQuoteBlockForPricing,
  hasLogisticsIntent,
  parseCarrier,
  parseDestination,
  parseEditDescription,
  parseEditPrice,
  parseExplicitPrice,
  parsePaymentTerms,
  parseProductQuery,
  parseQuotationEditRequest,
  parseQuotationRequest,
  parseQuotationSplitRequest,
  parseQuotationSendFollowup,
  prepareActiveQuotationDelivery,
  prepareAndCreateQuotation,
  recomputePaymentTerms,
  splitActiveQuotation,
  splitItemSubtotal,
  splitPaymentTerms,
  splitPricing,
  buildSplitQuotationDocument,
  resolveLogistics,
  selectDistanceRule,
  selectLogisticsRule,
  trace,
  visibleQuotationError
};
