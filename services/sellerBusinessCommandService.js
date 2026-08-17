'use strict';

const { randomUUID } = require('node:crypto');
const businessCommands = require('./ownerBusinessCommandService');
const {
  formalQuoteBlockForPricing,
  resolveLogistics
} = require('./ownerQuotationService');
const {
  createQuotation,
  createSellerCustomer,
  listSellerCustomers,
  resolveCatalogPricing,
  sendQuotationWhatsApp
} = require('./sellerBusinessConnectClient');
const {
  readSellerContext,
  updateSellerContext
} = require('./sellerBusinessContextService');
const { resolveAccessPolicy, assertScope } = require('./accessPolicyService');

const ALLOWED_TYPES = new Set([
  businessCommands.BUSINESS_COMMANDS.CUSTOMER_CREATE,
  businessCommands.BUSINESS_COMMANDS.CUSTOMER_SEARCH,
  businessCommands.BUSINESS_COMMANDS.CUSTOMER_LIST,
  businessCommands.BUSINESS_COMMANDS.QUOTATION_CREATE
]);

function sellerId(actor) {
  const id = String(actor?.sellerId || actor?.actorId || '').trim();
  if (!id) {
    const error = new Error('SELLER_ID_REQUIRED');
    error.code = 'SELLER_ID_REQUIRED';
    throw error;
  }
  return id;
}

function policyFor(actor) {
  return resolveAccessPolicy({ actorRole: 'seller', actorScopes: actor?.scopes || [] });
}

function money(value, currency = 'USD') {
  return `${currency} ${Number(value || 0).toFixed(2)}`;
}

function detectSellerBusinessCommand(message) {
  const command = businessCommands.detectOwnerBusinessCommand(message);
  if (!command || !ALLOWED_TYPES.has(command.type)) return null;
  return command;
}

async function sellerCustomers(actor, search = '') {
  const response = await listSellerCustomers(actor, search);
  const payload = response?.data || {};
  return Array.isArray(payload.results) ? payload.results : [];
}

async function executeCustomerCreate(command, actor) {
  assertScope(policyFor(actor), 'customer.own.create');
  const response = await createSellerCustomer(command.input || {}, actor);
  const customer = response?.data || response || {};
  const id = customer.customerId || customer.id;
  if (!id) {
    const error = new Error('CUSTOMER_CREATE_WITHOUT_ID');
    error.code = 'CUSTOMER_CREATE_WITHOUT_ID';
    throw error;
  }
  await updateSellerContext(sellerId(actor), {
    activeCustomerId: id,
    lastEntityType: 'customer',
    lastEntityId: id
  });
  return {
    handled: true,
    result: { customer },
    outputText: [
      '✅ Cliente registrado en la data oficial.',
      `Cliente: ${customer.name || customer.companyName || 'Cliente'}`,
      customer.phone || customer.whatsapp ? `WhatsApp: ${customer.phone || customer.whatsapp}` : '',
      'Quedó asignado a tu cartera de vendedor.'
    ].filter(Boolean).join('\n')
  };
}

async function executeCustomerList(command, actor) {
  assertScope(policyFor(actor), 'customer.own.read');
  const rows = await sellerCustomers(actor, '');
  if (command.countOnly) {
    return {
      handled: true,
      result: { count: rows.length, customers: rows },
      outputText: `Tenés ${rows.length} cliente${rows.length === 1 ? '' : 's'} registrado${rows.length === 1 ? '' : 's'}.`
    };
  }
  if (!rows.length) {
    return { handled: true, result: { count: 0, customers: [] }, outputText: 'No tenés clientes registrados todavía.' };
  }
  return {
    handled: true,
    result: { count: rows.length, customers: rows },
    outputText: ['Tus clientes:', ...rows.map((row, index) => `${index + 1}. ${row.companyName || row.name || 'Cliente'}`)].join('\n')
  };
}

async function executeCustomerSearch(command, actor) {
  assertScope(policyFor(actor), 'customer.own.read');
  const rows = await sellerCustomers(actor, command.query || '');
  if (!rows.length) {
    return { handled: true, result: { count: 0, customers: [] }, outputText: 'No encontré ese cliente dentro de tu cartera.' };
  }
  if (rows.length > 1) {
    return {
      handled: true,
      result: { count: rows.length, customers: rows },
      outputText: ['Encontré varios clientes en tu cartera:', ...rows.slice(0, 10).map((row, index) => `${index + 1}. ${row.companyName || row.name || 'Cliente'}`)].join('\n')
    };
  }
  const customer = rows[0];
  await updateSellerContext(sellerId(actor), {
    activeCustomerId: customer.customerId || customer.id,
    lastEntityType: 'customer',
    lastEntityId: customer.customerId || customer.id
  });
  return {
    handled: true,
    result: { count: 1, customer },
    outputText: `Cliente seleccionado: ${customer.companyName || customer.name || 'Cliente'}.`
  };
}

async function activeOwnedCustomer(actor) {
  const id = sellerId(actor);
  const context = await readSellerContext(id);
  if (!context.activeCustomerId) return null;
  const rows = await sellerCustomers(actor, '');
  return rows.find((row) => String(row.customerId || row.id) === String(context.activeCustomerId)) || null;
}

async function executeQuotationSend(actor) {
  assertScope(policyFor(actor), 'quotation.own.send');
  const id = sellerId(actor);
  const context = await readSellerContext(id);
  if (!context.activeProjectId) {
    return { handled: true, result: { ready: false }, outputText: 'No tenés una cotización activa para enviar.' };
  }
  const response = await sendQuotationWhatsApp(context.activeProjectId, actor, {});
  return {
    handled: true,
    result: response,
    outputText: '✅ Cotización enviada al cliente desde el registro oficial.'
  };
}

async function executeQuotationCreate(command, actor) {
  assertScope(policyFor(actor), 'quotation.own.create');
  const input = { ...(command.input || {}) };

  if (input.sendActive === true) return executeQuotationSend(actor);
  if (input.editActive === true) {
    return {
      handled: true,
      result: { ready: false, reason: 'SELLER_EDIT_REQUIRES_SAFE_ITEM_FLOW' },
      outputText: 'Para modificar una cotización de vendedor debo hacerlo con productos y precios autorizados. Indicame el producto o cambio comercial que querés agregar.'
    };
  }

  const manualPriceWasProvided = Boolean(input.explicitPrice);
  delete input.explicitPrice;
  delete input.priceIncludesLogistics;

  const customer = await activeOwnedCustomer(actor);
  if (!customer) {
    return {
      handled: true,
      result: { ready: false, reason: 'CUSTOMER_REQUIRED' },
      outputText: 'Primero registrá o buscá el cliente de tu cartera para asociar la cotización.'
    };
  }

  const logisticsResult = await resolveLogistics(input);
  if (!logisticsResult.ready) {
    return { handled: true, result: logisticsResult, outputText: logisticsResult.question || 'Falta información de entrega o instalación.' };
  }

  const pricingResponse = await resolveCatalogPricing({
    query: input.productQuery,
    width: input.width,
    height: input.height,
    quantity: input.quantity
  }, actor);
  const pricing = pricingResponse?.data || {};

  const formalBlock = formalQuoteBlockForPricing(pricing, null);
  if (formalBlock) {
    return { handled: true, result: formalBlock, outputText: formalBlock.question || 'Ese producto requiere un precio final autorizado antes de cotizar.' };
  }

  if (pricing.status === 'NOT_FOUND') {
    return { handled: true, result: { ready: false }, outputText: `No encontré “${input.productQuery}” en el catálogo autorizado.` };
  }
  if (pricing.status === 'MULTIPLE') {
    const names = (pricing.matches || []).slice(0, 5).map((item) => item.name).filter(Boolean);
    return { handled: true, result: { ready: false }, outputText: `Encontré varias opciones autorizadas: ${names.join(', ')}. Indicame cuál corresponde.` };
  }
  if (pricing.status === 'REQUIRES_INPUT') {
    return { handled: true, result: { ready: false }, outputText: 'Faltan medidas o datos necesarios para calcular el precio autorizado.' };
  }
  if (pricing.status !== 'FOUND' || !pricing.item || !pricing.calculation) {
    return { handled: true, result: { ready: false }, outputText: 'El producto no tiene un precio final autorizado disponible para cotizar.' };
  }

  const currency = pricing.calculation.currency || 'USD';
  if (currency !== 'USD') {
    return { handled: true, result: { ready: false }, outputText: `El precio autorizado está en ${currency}; necesito la conversión oficial antes de crear la cotización.` };
  }

  const logisticsAmount = Number(logisticsResult.amount || 0);
  if (logisticsAmount > 0 && logisticsResult.currency !== currency) {
    return { handled: true, result: { ready: false }, outputText: 'La logística y el producto están en monedas distintas; no voy a inventar un tipo de cambio.' };
  }

  const item = pricing.item;
  const subtotal = Number(pricing.calculation.subtotal || 0);
  const total = Number((subtotal + logisticsAmount).toFixed(2));
  const terms = input.paymentTerms || { depositPercent: 60, balancePercent: 40 };
  const depositUsd = Number((total * Number(terms.depositPercent || 60) / 100).toFixed(2));
  const balanceUsd = Number((total - depositUsd).toFixed(2));
  const actorSellerId = sellerId(actor);

  const items = [{
    itemId: item.id,
    catalogItemId: item.id,
    code: item.code,
    title: item.name,
    description: item.description || input.productQuery,
    quantity: Number(pricing.calculation.billableUnits || input.quantity || 1),
    unit: item.unit || 'servicio',
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

  const customerId = customer.customerId || customer.id;
  const document = {
    quotation: {
      status: 'draft',
      source: {
        type: 'seller-whatsapp',
        sourceId: `SELLER-${actorSellerId}-${randomUUID()}`,
        channel: 'seller-whatsapp'
      }
    },
    project: {
      title: item.name,
      status: 'pending_activation',
      currentStage: 'quotation'
    },
    relations: {
      customerId,
      executiveId: actorSellerId
    },
    customerSnapshot: {
      customerId,
      name: customer.name || customer.companyName,
      companyName: customer.companyName || '',
      phone: customer.phone || customer.whatsapp || '',
      email: customer.email || '',
      address: customer.address || '',
      city: customer.city || '',
      sellerId: actorSellerId
    },
    executiveSnapshot: {
      executiveId: actorSellerId,
      name: actor.displayName || 'Ejecutivo de ventas',
      role: 'seller'
    },
    items,
    pricing: {
      subtotalUsd: total,
      discountUsd: 0,
      taxUsd: 0,
      totalUsd: total
    },
    paymentTerms: {
      depositPercent: Number(terms.depositPercent || 60),
      balancePercent: Number(terms.balancePercent ?? 40),
      depositUsd,
      balanceUsd
    },
    contractVersion: '1.0.0'
  };

  const createdResponse = await createQuotation(
    document,
    `seller-${actorSellerId}-${randomUUID()}`,
    actor
  );
  const created = createdResponse?.data || createdResponse || {};

  await updateSellerContext(actorSellerId, {
    activeCustomerId: customerId,
    activeQuotationId: created.quotationId || null,
    activeQuotationNumber: created.quotationNumber || null,
    activeQuotationPublicUrl: created.publicUrl || null,
    activeProjectId: created.projectId || null,
    lastQuotationTotalUsd: total,
    lastEntityType: 'quotation',
    lastEntityId: created.quotationId || created.projectId || null
  });

  return {
    handled: true,
    result: { ready: true, created: true, quotation: created },
    outputText: [
      '✅ Cotización oficial creada con precio autorizado.',
      manualPriceWasProvided ? 'El precio escrito manualmente fue ignorado; se usó la autoridad oficial de precios.' : '',
      `Cliente: ${customer.companyName || customer.name || 'Cliente'}`,
      `Concepto: ${item.name}`,
      input.width && input.height ? `Medida: ${input.width} × ${input.height}` : '',
      logisticsResult.description ? `Logística: ${logisticsResult.description}` : '',
      `Total: ${money(total, currency)}`,
      `Anticipo ${terms.depositPercent || 60}%: ${money(depositUsd, currency)}`,
      `Saldo ${terms.balancePercent ?? 40}%: ${money(balanceUsd, currency)}`,
      `Cotización: ${created.quotationNumber || created.quotationId || 'creada'}`,
      created.publicUrl ? `Enlace: ${created.publicUrl}` : '',
      'Podés revisarla y luego decir: “mandásela”.'
    ].filter(Boolean).join('\n')
  };
}

async function executeSellerBusinessCommand(command, actor) {
  if (!command || !ALLOWED_TYPES.has(command.type)) {
    return { handled: false, outputText: null, result: null };
  }
  if (command.type === businessCommands.BUSINESS_COMMANDS.CUSTOMER_CREATE) return executeCustomerCreate(command, actor);
  if (command.type === businessCommands.BUSINESS_COMMANDS.CUSTOMER_LIST) return executeCustomerList(command, actor);
  if (command.type === businessCommands.BUSINESS_COMMANDS.CUSTOMER_SEARCH) return executeCustomerSearch(command, actor);
  if (command.type === businessCommands.BUSINESS_COMMANDS.QUOTATION_CREATE) return executeQuotationCreate(command, actor);
  return { handled: false, outputText: null, result: null };
}

module.exports = {
  ALLOWED_TYPES,
  detectSellerBusinessCommand,
  executeSellerBusinessCommand,
  executeQuotationCreate
};
