'use strict';

const { getConfig } = require('../../adapters/jobSupabaseAdapter');

const COMMANDS = Object.freeze({
  ACTIVE_PROJECTS: 'active_projects',
  PROJECTS_BY_CUSTOMER: 'projects_by_customer',
  PRODUCTION_BY_CUSTOMER: 'production_by_customer',
  QUOTATIONS_WITHOUT_FOLLOW_UP: 'quotations_without_follow_up',
  DEPOSITS_WITHOUT_WORK_ORDER: 'deposits_without_work_order',
  PROJECTS_BLOCKED_BY_PURCHASES: 'projects_blocked_by_purchases',
  OPEN_PURCHASE_ORDERS: 'open_purchase_orders',
  PENDING_SUPPLIER_DELIVERIES: 'pending_supplier_deliveries',
  SUPPLIER_DELIVERY_STATUS: 'supplier_delivery_status',
  PENDING_SUPPLIER_PAYMENTS: 'pending_supplier_payments'
});

const ADMIN_ROLES = new Set(['admin', 'owner']);
const EXECUTIVE_ROLES = new Set(['sales', 'ventas', 'executive', 'ejecutivo']);
const ACTIVE_QUOTATION_STATUSES = new Set(['draft', 'quoted', 'sent', 'viewed', 'approved', 'awaiting_deposit']);
const ACTIVE_PROJECT_STATUSES = new Set(['active', 'design', 'work_order_ready', 'production', 'installation']);
const OPEN_PURCHASE_ORDER_STATUSES = new Set([
  'draft',
  'pending_approval',
  'approved',
  'ordered',
  'partially_received'
]);
const SUPPLIER_DELIVERED_STATUSES = new Set([
  'delivered',
  'received',
  'completed'
]);
const SUPPLIER_PROGRESS_STATUSES = new Set([
  'ready',
  'partial',
  'partially_ready',
  'partially_delivered',
  'in_progress'
]);
const CLOSED_PAYMENT_STATUSES = new Set([
  'paid',
  'completed',
  'cancelled',
  'canceled',
  'void'
]);

function normalize(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function resolveIntent(message = '') {
  const text = normalize(message);
  if (!text) return null;

  const asksGlobalActiveProjects =
    (
      text.includes('proyectos activos') ||
      text.includes('proyectos tengo activos') ||
      text.includes('proyectos estan activos') ||
      text.includes('trabajos activos') ||
      text.includes('trabajos tengo activos') ||
      text.includes('que tengo activo') ||
      text.includes('que tengo abierto') ||
      text.includes('que tengo andando') ||
      text.includes('que tengo en marcha') ||
      text.includes('que tenemos activo') ||
      text.includes('que tenemos abierto') ||
      text.includes('que tenemos andando') ||
      text.includes('que tenemos en marcha') ||
      text.includes('como van los trabajos') ||
      text.includes('como van los proyectos') ||
      text.includes('que trabajos siguen') ||
      text.includes('que proyectos siguen') ||
      text.includes('que hay activo') ||
      text.includes('que hay abierto') ||
      text.includes('que hay andando') ||
      text.includes('que hay en marcha')
    ) &&
    !text.includes('cliente');

  if (asksGlobalActiveProjects) {
    return COMMANDS.ACTIVE_PROJECTS;
  }

  const asksOpenPurchaseOrders =
    text.includes('compras pendientes') ||
    text.includes('compras tengo pendientes') ||
    text.includes('ordenes de compra abiertas') ||
    text.includes('ordenes de compra pendientes') ||
    text.includes('oc abiertas') ||
    text.includes('oc pendientes') ||
    text.includes('compras siguen abiertas') ||
    text.includes('ordenes de compra siguen abiertas');

  if (asksOpenPurchaseOrders) {
    return COMMANDS.OPEN_PURCHASE_ORDERS;
  }

  const asksPendingDeliveries =
    text.includes('entregas pendientes') ||
    text.includes('entregas estan pendientes') ||
    text.includes('entregas siguen pendientes') ||
    text.includes('que entregas faltan') ||
    text.includes('que falta entregar') ||
    text.includes('que falta de proveedor') ||
    text.includes('que materiales faltan') ||
    text.includes('proveedor no ha entregado') ||
    text.includes('proveedores no han entregado') ||
    text.includes('proveedor falta entregar') ||
    text.includes('proveedores faltan entregar') ||
    text.includes('esperando material') ||
    text.includes('material pendiente de proveedor') ||
    text.includes('pendiente de entrega');

  if (asksPendingDeliveries) {
    return COMMANDS.PENDING_SUPPLIER_DELIVERIES;
  }

  const asksSupplierDeliveryStatus =
    (
      text.includes('ya entrego ') ||
      text.includes('entrego el proveedor') ||
      text.includes('entrego proveedor') ||
      text.includes('como va la entrega de') ||
      text.includes('estado de entrega de')
    ) &&
    (
      text.includes('entrego') ||
      text.includes('entrega')
    );

  if (asksSupplierDeliveryStatus) {
    return COMMANDS.SUPPLIER_DELIVERY_STATUS;
  }

  const asksPendingSupplierPayments =
    text.includes('pagarle a proveedores') ||
    text.includes('pagar a proveedores') ||
    text.includes('pagos pendientes a proveedores') ||
    text.includes('pagos de proveedores pendientes') ||
    text.includes('que debo pagar') ||
    text.includes('que hay que pagar a proveedores');

  if (asksPendingSupplierPayments) {
    return COMMANDS.PENDING_SUPPLIER_PAYMENTS;
  }

  if ((text.includes('produccion') || text.includes('en produccion')) &&
      (text.includes('cliente') || text.includes('de ') || text.includes('trabajo'))) {
    return COMMANDS.PRODUCTION_BY_CUSTOMER;
  }
  if (text.includes('sin seguimiento') || text.includes('no tienen seguimiento') || text.includes('seguimiento pendiente')) {
    return COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP;
  }
  if ((text.includes('anticipo') || text.includes('deposito')) &&
      (text.includes('sin ot') || text.includes('sin orden de trabajo') || text.includes('no tienen orden de trabajo'))) {
    return COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER;
  }
  if ((text.includes('bloqueado') || text.includes('bloqueando') || text.includes('detenido') || text.includes('parado')) &&
      (text.includes('compra') || text.includes('proveedor') || text.includes('material'))) {
    return COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES;
  }
  if (text.includes('proyectos de') || text.includes('trabajos de') || text.includes('cotizaciones de')) {
    return COMMANDS.PROJECTS_BY_CUSTOMER;
  }
  return null;
}

function extractCustomer(message = '') {
  const text = String(message).trim();
  const patterns = [
    /(?:proyectos|trabajos|cotizaciones)\s+de\s+(.+?)(?:\s+en\s+producci[oó]n|\?|$)/i,
    /(?:cliente)\s+(.+?)(?:\?|$)/i,
    /(?:de)\s+(.+?)\s+en\s+producci[oó]n/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function extractSupplier(message = '') {
  const original = String(message || '').trim();

  const patterns = [
    /(?:ya\s+)?entreg[oó]\s+(.+?)(?:\?|$)/i,
    /(?:proveedor)\s+(.+?)(?:\?|$)/i,
    /(?:entrega\s+de)\s+(.+?)(?:\?|$)/i
  ];

  for (const pattern of patterns) {
    const match = original.match(pattern);
    if (match?.[1]) {
      return match[1]
        .replace(/^(el|la)\s+/i, '')
        .trim();
    }
  }

  return '';
}

function createHeaders(key, legacyJwt) {
  const headers = { apikey: key, Accept: 'application/json' };
  if (legacyJwt) headers.Authorization = `Bearer ${key}`;
  return headers;
}

function createRestReader({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  async function select(table, query = '') {
    const { url, key, legacyJwt } = getConfig(env);
    const response = await fetchImpl(`${url}/rest/v1/${table}?${query}`, {
      headers: createHeaders(key, legacyJwt)
    });
    const data = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(data)) {
      const error = new Error(`QUOTE_CORE_QUERY_FAILED:${table}`);
      error.code = 'QUOTE_CORE_QUERY_FAILED';
      error.status = response.status;
      throw error;
    }
    return data;
  }
  return Object.freeze({ select });
}

function resolveScope(actor = {}) {
  const role = normalize(actor.role);
  if (ADMIN_ROLES.has(role)) return { role, executiveId: '' };
  if (EXECUTIVE_ROLES.has(role) && actor.executiveId) return { role, executiveId: actor.executiveId };
  return null;
}

function matchesCustomer(row, customerQuery) {
  const needle = normalize(customerQuery);
  if (!needle) return true;
  return [
    row.customer_snapshot?.name,
    row.customer_snapshot?.companyName,
    row.customer_name,
    row.customer_company_name,
    row.customer_id
  ].some(value => normalize(value).includes(needle));
}

function projectPublic(row) {
  return {
    projectNumber: row.project_number,
    title: row.title || '',
    status: row.status,
    currentStage: row.current_stage,
    expectedDeliveryAt: row.expected_delivery_at,
    customerName: row.customer_snapshot?.name || '',
    customerCompanyName: row.customer_snapshot?.companyName || ''
  };
}

function quotationPublic(row) {
  return {
    quotationNumber: row.quotation_number,
    status: row.status,
    customerName: row.customer_snapshot?.name || '',
    customerCompanyName: row.customer_snapshot?.companyName || '',
    issuedAt: row.issued_at,
    validUntil: row.valid_until
  };
}

function purchaseOrderPublic(row) {
  return {
    purchaseOrderId: row.id,
    purchaseOrderNumber: row.purchase_order_number,
    projectId: row.project_id,
    workOrderId: row.work_order_id,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name_snapshot || '',
    status: row.status,
    expectedAt: row.expected_at || null,
    blocksProduction: Boolean(row.blocks_production),
    currency: row.currency || '',
    total: row.total ?? null
  };
}

function summarizeDeliveryLines(lines = []) {
  if (!lines.length) {
    return {
      supplierReport: 'sin reporte del proveedor',
      supplierDelivered: false,
      internalReceived: false,
      internalConformity: false
    };
  }

  const normalizedStatuses = lines.map(row => normalize(row.supplier_status));
  const supplierDelivered =
    normalizedStatuses.length > 0 &&
    normalizedStatuses.every(status => SUPPLIER_DELIVERED_STATUSES.has(status));

  const hasProgress =
    lines.some(row =>
      SUPPLIER_PROGRESS_STATUSES.has(normalize(row.supplier_status)) ||
      Number(row.supplier_ready_qty || 0) > 0 ||
      Number(row.supplier_delivered_qty || 0) > 0
    );

  const internalReceived =
    lines.every(row =>
      Boolean(row.internal_received_at) ||
      Number(row.internal_received_qty || 0) > 0
    );

  const internalConformity =
    lines.every(row => row.internal_conformity === true);

  return {
    supplierReport:
      supplierDelivered
        ? 'proveedor reporta entregado'
        : hasProgress
          ? 'proveedor reporta avance'
          : 'pendiente de reporte del proveedor',
    supplierDelivered,
    internalReceived,
    internalConformity
  };
}

function deliveryPublic(order, lines = []) {
  const summary = summarizeDeliveryLines(lines);

  return {
    ...purchaseOrderPublic(order),
    deliveryLines: lines.length,
    supplierReport: summary.supplierReport,
    supplierDelivered: summary.supplierDelivered,
    internalReceived: summary.internalReceived,
    internalConformity: summary.internalConformity
  };
}

function paymentOrderPublic(row) {
  return {
    paymentOrderId: row.id,
    paymentOrderNumber:
      row.payment_order_number ||
      row.supplier_payment_order_number ||
      row.order_number ||
      '',
    purchaseOrderId: row.purchase_order_id || null,
    supplierId: row.supplier_id || null,
    supplierName:
      row.supplier_name_snapshot ||
      row.supplier_name ||
      '',
    status: row.status || '',
    currency: row.currency || '',
    amount:
      row.amount ??
      row.total ??
      row.total_amount ??
      null,
    createdAt: row.created_at || null
  };
}

function queryParam(name, value) {
  return value ? `&${name}=eq.${encodeURIComponent(value)}` : '';
}

function format(command, rows, customerQuery = '', supplierQuery = '') {
  const customer = customerQuery ? ` de ${customerQuery}` : '';
  const supplier = supplierQuery ? ` de ${supplierQuery}` : '';

  if (command === COMMANDS.OPEN_PURCHASE_ORDERS) {
    if (!rows.length) return 'No encontré órdenes de compra abiertas.';
    return [
      `${rows.length} orden(es) de compra abierta(s):`,
      ...rows.map((row, index) => {
        const total =
          row.total === null || row.total === undefined
            ? ''
            : ` · ${row.currency || ''} ${row.total}`.trimEnd();
        return `${index + 1}. ${row.purchaseOrderNumber || 'OC'} — ${row.supplierName || 'Proveedor sin nombre'} · ${row.status}${total}`;
      })
    ].join('\n');
  }

  if (
    command === COMMANDS.PENDING_SUPPLIER_DELIVERIES ||
    command === COMMANDS.SUPPLIER_DELIVERY_STATUS
  ) {
    if (!rows.length) {
      return command === COMMANDS.SUPPLIER_DELIVERY_STATUS
        ? `No encontré órdenes de compra${supplier} para consultar la entrega.`
        : 'No encontré entregas pendientes de proveedor.';
    }

    const header =
      command === COMMANDS.SUPPLIER_DELIVERY_STATUS
        ? `Estado de entrega${supplier}:`
        : `${rows.length} entrega(s) pendiente(s) de proveedor:`;

    return [
      header,
      ...rows.map((row, index) => {
        const internal =
          row.internalReceived
            ? row.internalConformity
              ? 'recibido internamente y conforme'
              : 'recibido internamente, conformidad pendiente'
            : 'recepción interna pendiente';

        return `${index + 1}. ${row.purchaseOrderNumber || 'OC'} — ${row.supplierName || 'Proveedor sin nombre'} · ${row.supplierReport} · ${internal}`;
      })
    ].join('\n');
  }

  if (command === COMMANDS.PENDING_SUPPLIER_PAYMENTS) {
    if (!rows.length) {
      return 'No encontré órdenes de pago pendientes a proveedores.';
    }

    return [
      `${rows.length} pago(s) pendiente(s) a proveedores:`,
      ...rows.map((row, index) => {
        const amount =
          row.amount === null || row.amount === undefined
            ? ''
            : ` · ${row.currency || ''} ${row.amount}`.trimEnd();

        return `${index + 1}. ${row.paymentOrderNumber || row.paymentOrderId || 'Pago'} — ${row.supplierName || 'Proveedor'} · ${row.status || 'pendiente'}${amount}`;
      })
    ].join('\n');
  }
  if (!rows.length) {
    const empty = {
      [COMMANDS.ACTIVE_PROJECTS]: 'No encontré proyectos activos.',
      [COMMANDS.PRODUCTION_BY_CUSTOMER]: `No encontré trabajos${customer} en producción.`,
      [COMMANDS.PROJECTS_BY_CUSTOMER]: `No encontré proyectos${customer}.`,
      [COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP]: 'No encontré cotizaciones activas sin seguimiento.',
      [COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER]: 'No encontré anticipos confirmados pendientes de Orden de Trabajo.',
      [COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES]: 'No encontré proyectos bloqueados por compras.'
    };
    return empty[command] || 'No encontré resultados.';
  }

  const headers = {
    [COMMANDS.ACTIVE_PROJECTS]: `${rows.length} proyecto(s) activo(s):`,
    [COMMANDS.PRODUCTION_BY_CUSTOMER]: `${rows.length} trabajo(s)${customer} en producción:`,
    [COMMANDS.PROJECTS_BY_CUSTOMER]: `${rows.length} proyecto(s)${customer}:`,
    [COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP]: `${rows.length} cotización(es) requieren seguimiento:`,
    [COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER]: `${rows.length} proyecto(s) tienen anticipo confirmado y aún no tienen OT:`,
    [COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES]: `${rows.length} proyecto(s) están bloqueados por compras:`
  };
  const lines = rows.map((row, index) => {
    const number = row.projectNumber || row.quotationNumber || `Registro ${index + 1}`;
    const title = row.title || row.customerCompanyName || row.customerName || '';
    const state = row.currentStage || row.status || '';
    return `${index + 1}. ${number}${title ? ` — ${title}` : ''}${state ? ` · ${state}` : ''}`;
  });
  return [headers[command], ...lines].join('\n');
}

async function executeQuery({ command, customerQuery, scope, reader, staleDays = 3 } = {}) {
  const executiveFilter = queryParam('executive_id', scope.executiveId);

  if (command === COMMANDS.OPEN_PURCHASE_ORDERS) {
    if (!ADMIN_ROLES.has(scope.role)) throw new Error('QUOTE_CORE_ADMIN_REQUIRED');

    const rows = await reader.select(
      'elankav_purchase_orders',
      'select=*&order=created_at.desc&limit=100'
    );

    return rows
      .filter(row => OPEN_PURCHASE_ORDER_STATUSES.has(normalize(row.status)))
      .map(purchaseOrderPublic);
  }

  if (
    command === COMMANDS.PENDING_SUPPLIER_DELIVERIES ||
    command === COMMANDS.SUPPLIER_DELIVERY_STATUS
  ) {
    if (!ADMIN_ROLES.has(scope.role)) throw new Error('QUOTE_CORE_ADMIN_REQUIRED');

    const orders = await reader.select(
      'elankav_purchase_orders',
      'select=*&order=created_at.desc&limit=100'
    );

    const supplierNeedle = normalize(customerQuery);
    const results = [];

    for (const order of orders) {
      if (
        command === COMMANDS.PENDING_SUPPLIER_DELIVERIES &&
        !OPEN_PURCHASE_ORDER_STATUSES.has(normalize(order.status))
      ) {
        continue;
      }

      if (
        command === COMMANDS.SUPPLIER_DELIVERY_STATUS &&
        supplierNeedle &&
        ![
          order.supplier_name_snapshot,
          order.supplier_id
        ].some(value => normalize(value).includes(supplierNeedle))
      ) {
        continue;
      }

      const lines = await reader.select(
        'elankav_purchase_order_delivery_lines',
        `select=*&purchase_order_id=eq.${encodeURIComponent(order.id)}&order=created_at.asc&limit=500`
      );

      const item = deliveryPublic(order, lines);

      if (
        command === COMMANDS.PENDING_SUPPLIER_DELIVERIES &&
        item.supplierDelivered === true &&
        item.internalReceived === true &&
        item.internalConformity === true
      ) {
        continue;
      }

      results.push(item);
    }

    return results;
  }

  if (command === COMMANDS.PENDING_SUPPLIER_PAYMENTS) {
    if (!ADMIN_ROLES.has(scope.role)) throw new Error('QUOTE_CORE_ADMIN_REQUIRED');

    const rows = await reader.select(
      'elankav_supplier_payment_orders',
      'select=*&order=created_at.desc&limit=100'
    );

    return rows
      .filter(row => !CLOSED_PAYMENT_STATUSES.has(normalize(row.status)))
      .map(paymentOrderPublic);
  }

  if (command === COMMANDS.ACTIVE_PROJECTS) {
    const rows = await reader.select(
      'elankav_projects',
      `select=*&order=created_at.desc&limit=100${executiveFilter}`
    );

    return rows
      .filter(row => ACTIVE_PROJECT_STATUSES.has(row.status))
      .map(projectPublic);
  }

  if (command === COMMANDS.PRODUCTION_BY_CUSTOMER || command === COMMANDS.PROJECTS_BY_CUSTOMER) {
    const statusFilter = command === COMMANDS.PRODUCTION_BY_CUSTOMER ? '&status=eq.production' : '';
    const rows = await reader.select(
      'elankav_projects',
      `select=*&order=created_at.desc&limit=100${executiveFilter}${statusFilter}`
    );
    return rows.filter(row => matchesCustomer(row, customerQuery)).map(projectPublic);
  }

  if (command === COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP) {
    const quotations = await reader.select(
      'elankav_quotations',
      `select=*&order=created_at.desc&limit=100${executiveFilter}`
    );
    const now = Date.now();
    const results = [];
    for (const row of quotations) {
      if (!ACTIVE_QUOTATION_STATUSES.has(row.status)) continue;
      const followUps = await reader.select(
        'elankav_quotation_follow_ups',
        `select=*&quotation_id=eq.${encodeURIComponent(row.id)}&completed_at=is.null&order=created_at.desc&limit=1`
      );
      const followUp = followUps[0] || null;
      const activity = followUp?.last_follow_up_at || row.viewed_at || row.sent_at || row.updated_at || row.created_at;
      const stale = !activity || ((now - new Date(activity).getTime()) / 86400000) >= staleDays;
      const overdue = followUp?.next_follow_up_at && new Date(followUp.next_follow_up_at).getTime() < now;
      if (stale && (!followUp?.next_action || !followUp?.next_follow_up_at || overdue)) {
        results.push(quotationPublic(row));
      }
    }
    return results;
  }

  if (command === COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER) {
    const quotations = await reader.select(
      'elankav_quotations',
      `select=*&status=eq.deposit_confirmed&order=created_at.desc&limit=100${executiveFilter}`
    );
    const results = [];
    for (const quotation of quotations) {
      const projects = await reader.select(
        'elankav_projects',
        `select=*&quotation_id=eq.${encodeURIComponent(quotation.id)}&limit=1${executiveFilter}`
      );
      const project = projects[0];
      if (!project) continue;
      const workOrders = await reader.select(
        'elankav_work_orders',
        `select=id&project_id=eq.${encodeURIComponent(project.id)}&limit=1`
      );
      if (!workOrders.length) results.push(projectPublic(project));
    }
    return results;
  }

  if (command === COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES) {
    if (!ADMIN_ROLES.has(scope.role)) throw new Error('QUOTE_CORE_ADMIN_REQUIRED');
    const projects = await reader.select('elankav_projects', 'select=*&order=created_at.desc&limit=100');
    const results = [];
    for (const project of projects.filter(row => ACTIVE_PROJECT_STATUSES.has(row.status))) {
      const orders = await reader.select(
        'elankav_purchase_orders',
        `select=*&project_id=eq.${encodeURIComponent(project.id)}&blocks_production=eq.true&status=in.(draft,pending_approval,approved,ordered,partially_received)`
      );
      if (orders.length) results.push(projectPublic(project));
    }
    return results;
  }

  return [];
}

async function processQuoteRuntimeCommand({
  message,
  actor,
  env = process.env,
  reader = null
} = {}) {
  const command = resolveIntent(message);
  if (!command) return { handled: false };

  const scope = resolveScope(actor);
  if (!scope) return { handled: false };

  if (String(env.QUOTE_CORE_RUNTIME_ENABLED || '').toLowerCase() !== 'true' && !reader) {
    return { handled: false, reason: 'QUOTE_CORE_RUNTIME_DISABLED' };
  }

  try {
    const resolvedReader = reader || createRestReader({ env });
    const customerQuery = extractCustomer(message);
    const supplierQuery =
      command === COMMANDS.SUPPLIER_DELIVERY_STATUS
        ? extractSupplier(message)
        : '';

    const queryContext =
      command === COMMANDS.SUPPLIER_DELIVERY_STATUS
        ? supplierQuery
        : customerQuery;

    const rows = await executeQuery({
      command,
      customerQuery: queryContext,
      scope,
      reader: resolvedReader
    });

    return {
      handled: true,
      command,
      outputText: format(command, rows, customerQuery, supplierQuery),
      rows,
      scope: ADMIN_ROLES.has(scope.role) ? 'global' : 'own'
    };
  } catch (error) {
    return {
      handled: false,
      reason: error.code || 'QUOTE_CORE_RUNTIME_UNAVAILABLE'
    };
  }
}

module.exports = {
  COMMANDS,
  createRestReader,
  executeQuery,
  extractCustomer,
  extractSupplier,
  format,
  processQuoteRuntimeCommand,
  resolveIntent,
  resolveScope
};
