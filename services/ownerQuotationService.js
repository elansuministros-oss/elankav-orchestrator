'use strict';

const { randomUUID } = require('node:crypto');
const {
  createQuotation,
  listLogisticsRules,
  resolveCatalogPricing,
  searchCustomers
} = require('./ownerBusinessConnectClient');
const { readContext, updateContext } = require('./ownerBusinessContextService');
const { buildLogisticsRequest, DELIVERY_METHODS } = require('./quotationRequirementResolver');
const { computeRoadRoute } = require('./ownerRoutingService');

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
  const match = raw.match(/\b(?:instalad[oa]|instalacion|instalación|delivery|entrega|entregar|enviar)\s+(?:en|a|hacia)\s+([^,.\n]+?)(?=[,.\n]|$)/i);
  return match ? match[1].trim() : '';
}

function parseProductQuery(message) {
  let value = String(message || '').trim();
  value = value.replace(/^(?:elan[, ]+)?(?:cotiza|cotizame|cotízame|cotizar|realiza una cotizacion|realiza una cotización)\s*/i, '');
  value = value.replace(/\b(?:cantidad|cant|qty)\s*[:=]?\s*\d+(?:[.,]\d+)?\b/gi, '');
  value = value.replace(/\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?\s*(?:m|mts|metros|cm)?\b/gi, '');
  value = value.replace(/\b(?:instalad[oa]|instalacion|instalación|delivery|entrega|entregar|enviar)\b.*$/i, '');
  value = value.replace(/\b(?:con|sin)\s+(?:instalacion|instalación|delivery)\b.*$/i, '');
  return value.replace(/\s+/g, ' ').replace(/[,:;-]+$/g, '').trim();
}

function parseQuotationRequest(message) {
  const normalized = normalize(message);
  if (!/^(?:elan\s+)?(?:cotiza|cotizame|cotizar|realiza una cotizacion)\b/.test(normalized)) return null;
  const dimensions = parseDimensions(message);
  const carrier = parseCarrier(message);
  const destination = carrier.destination || parseDestination(message);
  const productQuery = parseProductQuery(message);
  if (!productQuery) return null;
  return {
    message: String(message || '').trim(),
    productQuery,
    width: dimensions.width,
    height: dimensions.height,
    quantity: parseQuantity(message),
    destination: destination || undefined,
    carrier: carrier.carrier || (/cargo\s*trans/i.test(message) ? 'Cargo Trans' : undefined)
  };
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
    return rows.find(rule =>
      rule.serviceType === 'carrier' &&
      matchesText(rule.provider, logistics.carrier) &&
      matchesText(rule.destination, logistics.destination)
    ) || null;
  }
  if (logistics.method === DELIVERY_METHODS.DELIVERY) {
    return rows.find(rule => rule.serviceType === 'delivery' && matchesText(rule.destination, logistics.destination)) || null;
  }
  return null;
}

function selectDistanceRule(rules) {
  return (Array.isArray(rules) ? rules : []).find(rule => rule.serviceType === 'distance' && rule.pricingUnit === 'per_km') || null;
}

async function resolveLogistics(input) {
  const request = buildLogisticsRequest({
    text: input.message,
    width: input.width,
    height: input.height,
    quantity: input.quantity,
    destination: input.destination,
    carrier: input.carrier
  });
  if (!request.ready) return { ready: false, question: request.question, requirements: request.requirements };

  const logistics = request.logistics;
  if (logistics.method === DELIVERY_METHODS.PICKUP || !logistics.method) {
    return { ready: true, amount: 0, currency: 'USD', description: 'Retiro / sin logística adicional', details: logistics };
  }

  const response = await listLogisticsRules({});
  const rules = response.data || [];
  const directRule = selectLogisticsRule(rules, logistics);
  if (directRule) {
    if (directRule.pricingUnit !== 'flat') {
      return { ready: false, question: `La regla ${directRule.ruleCode || ''} requiere una unidad logística adicional antes de cotizar.`.trim() };
    }
    return {
      ready: true,
      amount: Number(directRule.rate),
      currency: directRule.currency,
      description: directRule.provider ? `${directRule.provider}: ${directRule.origin || ''} → ${directRule.destination || ''}` : `Delivery ${directRule.destination || ''}`,
      ruleId: directRule.id,
      ruleCode: directRule.ruleCode,
      details: logistics
    };
  }

  if (logistics.method === DELIVERY_METHODS.CARRIER) {
    return {
      ready: false,
      question: `No tengo una tarifa vigente de ${logistics.carrier || 'ese transportista'} para ${logistics.destination || 'ese destino'}. Podés indicármela por mensaje para registrarla.`
    };
  }

  const route = await computeRoadRoute(logistics.coordinates || logistics.destination);
  const distanceRule = selectDistanceRule(rules);
  if (!distanceRule) {
    return {
      ready: false,
      question: `Tengo la ruta (${route.oneWayKm.toFixed(2)} km por trayecto), pero no hay una tarifa por km vigente en la biblioteca logística.`
    };
  }
  const roundTripKm = Number((route.oneWayKm * 2 * Math.max(1, Number(logistics.trips) || 1)).toFixed(2));
  const amount = Number((roundTripKm * Number(distanceRule.rate)).toFixed(2));
  return {
    ready: true,
    amount,
    currency: distanceRule.currency,
    description: `Logística por carretera: ${roundTripKm.toFixed(2)} km facturables`,
    ruleId: distanceRule.id,
    ruleCode: distanceRule.ruleCode,
    route: { ...route, roundTripKm },
    details: logistics
  };
}

async function resolveActiveCustomer() {
  const context = await readContext();
  if (!context.activeCustomerId) {
    return { ready: false, question: '¿Para qué cliente preparo la cotización? Primero indicame o buscá el cliente.' };
  }
  const result = await searchCustomers(context.activeCustomerId);
  const rows = result?.data?.results || [];
  const match = rows.find(row => String(row?.customer?.customerId || row?.customer?.id || row?.sourceId || '') === String(context.activeCustomerId)) || rows[0];
  if (!match) return { ready: false, question: 'No pude resolver el cliente activo en el directorio oficial. Indicame nuevamente el cliente.' };
  return { ready: true, customer: match.customer || match };
}

function money(amount, currency) {
  return `${currency} ${Number(amount || 0).toFixed(2)}`;
}

async function prepareAndCreateQuotation(input) {
  const customerResult = await resolveActiveCustomer();
  if (!customerResult.ready) return customerResult;

  const logisticsResult = await resolveLogistics(input);
  if (!logisticsResult.ready) return logisticsResult;

  const pricingResponse = await resolveCatalogPricing({
    query: input.productQuery,
    width: input.width,
    height: input.height,
    quantity: input.quantity
  });
  const pricing = pricingResponse.data || {};
  if (pricing.status === 'NOT_FOUND') {
    return { ready: false, question: `No encontré “${input.productQuery}” en la biblioteca oficial. Necesito identificar el producto o servicio correcto antes de cotizar.` };
  }
  if (pricing.status === 'MULTIPLE') {
    const names = (pricing.matches || []).slice(0, 5).map(item => item.name).filter(Boolean);
    return { ready: false, question: `Encontré varias opciones en la biblioteca: ${names.join(', ')}. Indicame cuál corresponde.` };
  }
  if (pricing.status === 'REQUIRES_INPUT') {
    return { ready: false, question: 'Faltan medidas necesarias para calcular el precio de este producto.' };
  }
  if (pricing.status !== 'FOUND') {
    return { ready: false, question: 'El producto existe, pero no tiene un precio de venta vigente en la biblioteca oficial.' };
  }

  if (pricing.calculation.currency !== logisticsResult.currency && Number(logisticsResult.amount) > 0) {
    return {
      ready: false,
      question: `El producto está en ${pricing.calculation.currency} y la logística en ${logisticsResult.currency}. No voy a inventar un tipo de cambio; necesito una regla de conversión oficial antes de cerrar la cotización.`
    };
  }

  const currency = pricing.calculation.currency;
  const subtotal = Number(pricing.calculation.subtotal || 0);
  const logisticsAmount = Number(logisticsResult.amount || 0);
  const total = Number((subtotal + logisticsAmount).toFixed(2));
  if (currency !== 'USD') {
    return {
      ready: false,
      question: `La biblioteca devolvió ${currency}. El VQS oficial consolida el total principal en USD; necesito una conversión oficial antes de crear la cotización.`
    };
  }

  const customer = customerResult.customer;
  const item = pricing.item;
  const items = [{
    itemId: item.id,
    catalogItemId: item.id,
    code: item.code,
    title: item.name,
    description: item.description || input.productQuery,
    quantity: Number(pricing.calculation.billableUnits || input.quantity || 1),
    unit: item.unit,
    unitPriceUsd: Number(item.unitPrice),
    subtotalUsd: subtotal,
    source: 'MASTER_CATALOG'
  }];
  if (logisticsAmount > 0) {
    items.push({
      itemId: `LOG-${randomUUID()}`,
      title: logisticsResult.description || 'Logística',
      description: logisticsResult.description || 'Logística',
      quantity: 1,
      unit: 'servicio',
      unitPriceUsd: logisticsAmount,
      subtotalUsd: logisticsAmount,
      source: 'LOGISTICS_LIBRARY'
    });
  }

  const document = {
    quotation: {
      status: 'draft',
      source: { type: 'owner-whatsapp', sourceId: `OWNER-${randomUUID()}` }
    },
    project: {
      title: item.name,
      status: 'pending_activation',
      currentStage: 'quotation'
    },
    relations: { customerId: customer.customerId || customer.id },
    customerSnapshot: {
      customerId: customer.customerId || customer.id,
      name: customer.name || customer.companyName,
      companyName: customer.companyName || '',
      phone: customer.phone || '',
      email: customer.email || '',
      address: customer.address || '',
      city: customer.city || ''
    },
    executiveSnapshot: {
      executiveId: 'owner-whatsapp',
      name: 'ELAN Owner'
    },
    items,
    pricing: {
      subtotalUsd: total,
      discountUsd: 0,
      taxUsd: 0,
      totalUsd: total
    },
    paymentTerms: {
      depositPercent: 60,
      balancePercent: 40,
      depositUsd: Number((total * 0.6).toFixed(2)),
      balanceUsd: Number((total * 0.4).toFixed(2))
    },
    contractVersion: '1.0.0'
  };

  const createdResponse = await createQuotation(document, `owner-${randomUUID()}`);
  const created = createdResponse.data || createdResponse;
  await updateContext({
    activeCustomerId: customer.customerId || customer.id,
    activeQuotationId: created.quotationId || null,
    activeProjectId: created.projectId || null,
    lastEntityType: 'quotation',
    lastEntityId: created.quotationId || created.projectId || null
  });

  return {
    ready: true,
    created: true,
    quotation: created,
    summary: [
      '✅ Cotización oficial creada.',
      '',
      `Cliente: ${customer.name || customer.companyName}`,
      `Concepto: ${item.name}`,
      input.width && input.height ? `Medida: ${input.width} × ${input.height}` : '',
      logisticsResult.description ? `Logística: ${logisticsResult.description}` : '',
      `Total: ${money(total, currency)}`,
      `Anticipo 60%: ${money(total * 0.6, currency)}`,
      `Saldo 40%: ${money(total * 0.4, currency)}`,
      `Cotización: ${created.quotationNumber || created.quotationId}`,
      created.publicUrl ? `Enlace: ${created.publicUrl}` : ''
    ].filter(Boolean).join('\n')
  };
}

module.exports = {
  parseCarrier,
  parseDestination,
  parseProductQuery,
  parseQuotationRequest,
  prepareAndCreateQuotation,
  resolveLogistics,
  selectDistanceRule,
  selectLogisticsRule
};
