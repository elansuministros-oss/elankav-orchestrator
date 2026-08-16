'use strict';

const { randomUUID } = require('node:crypto');
const {
  createQuotation,
  listLogisticsRules,
  resolveCatalogPricing,
  searchCustomers
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
    'No se creó ninguna cotización. Revisaré este error sin duplicar registros.'
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
  value = value.replace(/^(?:elan[, ]+)?(?:cotiza|cotizame|cotízame|cotizar|realiza una cotizacion|realiza una cotización)\s*/i, '');
  value = value.replace(/^para\s+(?:(?:la|el)\s+)?(?:dra\.?|dr\.?|sra\.?|sr\.?)\s+[A-Za-zÁÉÍÓÚÑáéíóúñ .'-]+?\s+(?=(?:un|una|el|la)\s+)/i, '');
  value = value.replace(/\b(?:cantidad|cant|qty)\s*[:=]?\s*\d+(?:[.,]\d+)?\b/gi, '');
  value = value.replace(/\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:m|mts|metros|cm)?\b/gi, '');
  value = value.replace(/\b(?:instalad[oa]|instalacion|instalación|delivery|entrega|entregar|enviar)\b.*$/i, '');
  value = value.replace(/\b(?:precio|total)\s*[:=]?.*$/i, '');
  value = value.replace(/\bcondiciones?(?:\s+de\s+pago)?\b.*$/i, '');
  value = value.replace(/\b(?:con|sin)\s+(?:instalacion|instalación|delivery)\b.*$/i, '');
  return value.replace(/\s+/g, ' ').replace(/[,:;-]+$/g, '').trim();
}

function parseQuotationRequest(message) {
  if (parseQuotationSendFollowup(message)) return { sendActive: true, message: String(message || '').trim() };
  const normalized = normalize(message);
  if (!/^(?:elan\s+)?(?:cotiza|cotizame|cotizar|realiza una cotizacion)\b/.test(normalized)) return null;
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

async function prepareAndCreateQuotation(input) {
  if (input?.sendActive === true) return prepareActiveQuotationDelivery();

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
  errorDetails,
  hasLogisticsIntent,
  parseCarrier,
  parseDestination,
  parseExplicitPrice,
  parsePaymentTerms,
  parseProductQuery,
  parseQuotationRequest,
  parseQuotationSendFollowup,
  prepareActiveQuotationDelivery,
  prepareAndCreateQuotation,
  resolveLogistics,
  selectDistanceRule,
  selectLogisticsRule,
  trace,
  visibleQuotationError
};
