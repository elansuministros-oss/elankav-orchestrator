'use strict';

const { randomUUID } = require('node:crypto');
const {
  createQuotation,
  createSellerCustomer,
  listSellerCustomers,
  sendQuotationWhatsApp
} = require('./sellerBusinessConnectClient');
const {
  readSellerContext,
  updateSellerContext
} = require('./sellerBusinessContextService');
const {
  detectSellerBusinessCommand,
  executeSellerBusinessCommand
} = require('./sellerBusinessCommandService');

function text(value) {
  return String(value || '').trim();
}

function normalize(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function sellerId(actor = {}) {
  return text(actor.sellerId || actor.actorId || actor.sub);
}

function isSeller(actor = {}) {
  return normalize(actor.role) === 'seller' && Boolean(sellerId(actor));
}

function isFrost(value) {
  return /\b(?:vinil\s+)?fros(?:t|ted)?\b/i.test(normalize(value));
}

function hasUvPrintIntent(value) {
  return /\b(?:uv|impresion|impreso|impresa|imprimir)\b/i.test(normalize(value));
}

function frostPresentationQuestion(value) {
  const source = normalize(value);
  return isFrost(source) && /\b(?:61|ancho|medida|presentacion|presentación|rollo|tienen|hay|disponible)\b/i.test(source);
}

function canonicalFrostUvProduct() {
  return 'vinil frost con impresión UV';
}

function parseMeasurements(message) {
  const source = text(message).replace(/,/g, '.');
  const matches = [...source.matchAll(/(\d+(?:\.\d+)?)\s*(?:x|\*|×)\s*(\d+(?:\.\d+)?)/gi)];
  return matches
    .map((match) => ({ width: Number(match[1]), height: Number(match[2]), quantity: 1 }))
    .filter((item) => item.width > 0 && item.height > 0);
}

function quotationIntent(message) {
  const source = text(message);
  if (!/\b(cotiz(?:ar|acion|ación|ame|áme)|presupuest)/i.test(source)) return null;
  const cleaned = source
    .replace(/^.*?\b(?:cotiz(?:ar|acion|ación|ame|áme)|presupuest(?:ar|o))\b\s*/i, '')
    .replace(/^\s*(?:de|para)?\s*/i, '')
    .trim();
  const first = cleaned.split(/[\n,.;]/).map((part) => part.trim()).find(Boolean) || cleaned;
  let productQuery = first.replace(/^(?:el|la|los|las|un|una)\s+/i, '').trim();
  if (isFrost(productQuery) && hasUvPrintIntent(source)) productQuery = canonicalFrostUvProduct();
  if (!productQuery) return null;
  const locationMatch = source.match(/\b(?:queda|est[aá]|ubicad[oa])\s+en\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ\s-]{1,40})(?:[,.]|$)/i);
  return {
    productQuery,
    location: text(locationMatch?.[1]),
    measurements: parseMeasurements(source),
    raw: source
  };
}

function parseCustomerIdentity(message) {
  const source = text(message);
  const nameMatch = source.match(/(?:nombre\s+(?:del\s+)?cliente|cliente)\s*[:\-]?\s*([^\n,;]+?)(?=\s+(?:\+?505)?\s*\d{8}\b|\n|$)/i);
  const phoneMatch = source.match(/(?:\+?505[\s-]?)?(\d{4})[\s-]?(\d{4})\b/);
  const name = text(nameMatch?.[1]);
  const phone = phoneMatch ? `+505${phoneMatch[1]}${phoneMatch[2]}` : '';
  if (!name || !phone) return null;
  return { name, phone, whatsapp: phone };
}

function isCreateFollowUp(message) {
  return /^(?:si\s*,?\s*)?(?:creala|créala|crear|generala|genérala|emitila|emítela|formalizala|formalízala)(?:\s+(?:ya|por\s+favor))?[.!]?$/i.test(text(message));
}

function isLinkFollowUp(message) {
  return /(link|enlace).*(cotiz|revis|verific)|(?:mand|pas|dame).*(link|enlace)/i.test(text(message));
}

function isSendFollowUp(message) {
  return /^(?:elan[\s,:-]+)?(?:mand[aá]sela|mandasela|env[ií]asela|enviasela|mandala|m[aá]ndala|enviala|env[ií]ala)(?:\s+al\s+cliente)?[.!]?$/i.test(text(message));
}

async function findOrCreateCustomer(identity, actor) {
  const listed = await listSellerCustomers(actor, identity.phone);
  const rows = Array.isArray(listed?.data?.results) ? listed.data.results : [];
  const found = rows.find((row) => text(row.phone || row.whatsapp).replace(/\D/g, '').endsWith(identity.phone.replace(/\D/g, '').slice(-8)));
  if (found) return found;
  const created = await createSellerCustomer(identity, actor);
  return created?.data || created || {};
}

function buildQuotationDocument({ pending, customer, actor }) {
  const id = sellerId(actor);
  const customerId = text(customer.customerId || customer.id);
  const measurements = Array.isArray(pending.measurements) ? pending.measurements : [];
  const items = measurements.length
    ? measurements.map((measurement, index) => ({
        itemId: `SELLER-${index + 1}-${randomUUID()}`,
        pricingQuery: pending.productQuery,
        title: pending.productQuery,
        description: pending.location ? `${pending.productQuery} — ${pending.location}` : pending.productQuery,
        quantity: Number(measurement.quantity || 1),
        width: Number(measurement.width),
        height: Number(measurement.height),
        dimensions: { width: Number(measurement.width), height: Number(measurement.height) },
        source: 'SELLER_WHATSAPP_CONVERSATION'
      }))
    : [{
        itemId: `SELLER-1-${randomUUID()}`,
        pricingQuery: pending.productQuery,
        title: pending.productQuery,
        description: pending.location ? `${pending.productQuery} — ${pending.location}` : pending.productQuery,
        quantity: 1,
        source: 'SELLER_WHATSAPP_CONVERSATION'
      }];

  return {
    quotation: {
      status: 'draft',
      source: {
        type: 'seller-whatsapp',
        sourceId: `SELLER-${id}-${randomUUID()}`,
        channel: 'seller-whatsapp',
        sellerId: id
      }
    },
    project: {
      title: pending.productQuery,
      status: 'pending_activation',
      currentStage: 'quotation',
      ...(pending.location ? { location: pending.location } : {})
    },
    relations: { customerId, executiveId: id, sellerId: id },
    customerSnapshot: {
      customerId,
      name: text(customer.name || customer.companyName),
      companyName: text(customer.companyName),
      phone: text(customer.phone || customer.whatsapp),
      email: text(customer.email),
      address: text(customer.address),
      city: text(customer.city)
    },
    executiveSnapshot: {
      executiveId: id,
      sellerId: id,
      name: text(actor.displayName || actor.sellerName || 'Ejecutivo de ventas'),
      role: 'seller'
    },
    items,
    paymentTerms: { depositPercent: 60, balancePercent: 40 },
    notes: pending.location ? `Ubicación del proyecto: ${pending.location}` : '',
    contractVersion: '1.0.0'
  };
}

async function createPendingQuotation(current, actor) {
  const id = sellerId(actor);
  const pending = current.pendingQuotation;
  const pendingCustomer = current.pendingQuotationCustomer;
  if (!pending?.productQuery) {
    return { handled: true, outputText: 'No tengo una cotización pendiente estructurada para crear. Indicame primero qué producto o servicio querés cotizar.' };
  }
  if (!pendingCustomer?.customerId) {
    return { handled: true, outputText: 'Tengo el trabajo pendiente, pero falta asociar el cliente con nombre y WhatsApp antes de crear la cotización.' };
  }
  const customers = await listSellerCustomers(actor, '');
  const rows = Array.isArray(customers?.data?.results) ? customers.data.results : [];
  const customer = rows.find((row) => text(row.customerId || row.id) === text(pendingCustomer.customerId));
  if (!customer) {
    return { handled: true, outputText: 'El cliente pendiente ya no aparece en tu cartera autorizada. No voy a crear una cotización sin esa relación oficial.' };
  }

  const document = buildQuotationDocument({ pending, customer, actor });
  const createdResponse = await createQuotation(document, `seller-conversation-${id}-${randomUUID()}`, actor);
  const created = createdResponse?.data || createdResponse || {};
  await updateSellerContext(id, {
    activeQuotationId: created.quotationId || null,
    activeQuotationNumber: created.quotationNumber || null,
    activeQuotationPublicUrl: created.publicUrl || null,
    activeProjectId: created.projectId || null,
    lastQuotationTotalUsd: created.totalUsd || created.pricing?.totalUsd || null,
    lastEntityType: 'quotation',
    lastEntityId: created.quotationId || created.projectId || null,
    pendingQuotation: null,
    pendingQuotationCustomer: null
  });

  return {
    handled: true,
    result: created,
    outputText: [
      '✅ Cotización oficial creada en CONNECT.',
      created.quotationNumber ? `Cotización: ${created.quotationNumber}` : '',
      created.publicUrl ? `Enlace: ${created.publicUrl}` : '',
      'Podés revisarla y luego decir “mandásela”.'
    ].filter(Boolean).join('\n')
  };
}

async function handleSellerConversationMessage(message, actor) {
  if (!isSeller(actor)) return { handled: false };
  const id = sellerId(actor);
  const current = await readSellerContext(id);
  const pendingProduct = current.pendingQuotation?.productQuery || '';

  if ((frostPresentationQuestion(message) || (isFrost(pendingProduct) && /\b(?:61|ancho|medida|presentacion|presentación|rollo)\b/i.test(normalize(message)))) && (hasUvPrintIntent(message) || hasUvPrintIntent(current.pendingQuotation?.raw) || isFrost(pendingProduct))) {
    return {
      handled: true,
      outputText: 'Para vinil Frost con impresión UV, la presentación autorizada es de 1.37 m de ancho y la tarifa autorizada es US$25 por m². El Frost sin impresión se maneja como tarifa separada; no corresponde asumir 61 cm para este trabajo.'
    };
  }

  if (isFrost(pendingProduct) && hasUvPrintIntent(message)) {
    const pending = {
      ...current.pendingQuotation,
      productQuery: canonicalFrostUvProduct(),
      raw: `${text(current.pendingQuotation?.raw)}\n${text(message)}`.trim(),
      updatedAt: new Date().toISOString()
    };
    await updateSellerContext(id, { pendingQuotation: pending });
    return {
      handled: true,
      outputText: 'Actualicé el trabajo pendiente a vinil Frost con impresión UV: ancho autorizado 1.37 m y tarifa US$25 por m². Continuemos con las medidas o con la creación de la cotización.'
    };
  }

  if (isLinkFollowUp(message)) {
    if (!current.activeQuotationPublicUrl) {
      return { handled: true, outputText: 'No tenés una cotización oficial activa con enlace de revisión. Primero hay que crearla en CONNECT.' };
    }
    return { handled: true, outputText: `Enlace de revisión de tu cotización:\n${current.activeQuotationPublicUrl}` };
  }

  if (isSendFollowUp(message)) {
    if (!current.activeProjectId) {
      return { handled: true, outputText: 'No tenés una cotización oficial activa para enviar.' };
    }
    await sendQuotationWhatsApp(current.activeProjectId, actor, {});
    return { handled: true, outputText: '✅ Cotización enviada al cliente desde el registro oficial.' };
  }

  if (isCreateFollowUp(message)) {
    return createPendingQuotation(current, actor);
  }

  const quote = quotationIntent(message);
  if (quote) {
    const pending = {
      ...(current.pendingQuotation && typeof current.pendingQuotation === 'object' ? current.pendingQuotation : {}),
      ...quote,
      measurements: quote.measurements.length ? quote.measurements : (current.pendingQuotation?.measurements || []),
      updatedAt: new Date().toISOString()
    };
    await updateSellerContext(id, { pendingQuotation: pending });
    if (!pending.measurements.length) {
      const frostUvNote = pending.productQuery === canonicalFrostUvProduct() ? ' Usaré la tarifa autorizada de US$25/m² y presentación de 1.37 m.' : '';
      return { handled: true, outputText: `Perfecto. Voy a cotizar ${pending.productQuery}${pending.location ? ` para ${pending.location}` : ''}.${frostUvNote} Pasame las medidas en ancho × alto.` };
    }
    return { handled: true, outputText: `Tengo ${pending.measurements.length} medida${pending.measurements.length === 1 ? '' : 's'} para ${pending.productQuery}. Ahora indicame el nombre y WhatsApp del cliente.` };
  }

  const measures = parseMeasurements(message);
  if (measures.length && current.pendingQuotation?.productQuery) {
    const pending = {
      ...current.pendingQuotation,
      measurements: measures,
      updatedAt: new Date().toISOString()
    };
    await updateSellerContext(id, { pendingQuotation: pending });
    return { handled: true, outputText: `Registré ${measures.length} medida${measures.length === 1 ? '' : 's'}. Ahora indicame el nombre y WhatsApp del cliente.` };
  }

  const identity = parseCustomerIdentity(message);
  if (identity && current.pendingQuotation?.productQuery) {
    const customer = await findOrCreateCustomer(identity, actor);
    const customerId = text(customer.customerId || customer.id);
    if (!customerId) {
      const error = new Error('SELLER_CUSTOMER_WITHOUT_ID');
      error.code = 'SELLER_CUSTOMER_WITHOUT_ID';
      throw error;
    }
    await updateSellerContext(id, {
      activeCustomerId: customerId,
      pendingQuotationCustomer: { customerId, name: identity.name, phone: identity.phone }
    });
    return {
      handled: true,
      outputText: `Cliente ${identity.name} quedó asociado. Decime “creala” y voy a generar la cotización oficial usando únicamente precios autorizados de CONNECT.`
    };
  }

  const direct = detectSellerBusinessCommand(message);
  if (direct) {
    const outcome = await executeSellerBusinessCommand(direct, actor);
    if (outcome?.handled) return outcome;
  }

  return { handled: false };
}

module.exports = {
  buildQuotationDocument,
  canonicalFrostUvProduct,
  createPendingQuotation,
  frostPresentationQuestion,
  handleSellerConversationMessage,
  hasUvPrintIntent,
  isCreateFollowUp,
  isLinkFollowUp,
  isSendFollowUp,
  parseCustomerIdentity,
  parseMeasurements,
  quotationIntent
};
