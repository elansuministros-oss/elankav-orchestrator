'use strict';

const { getConfig } = require('../../adapters/jobSupabaseAdapter');

const COMMANDS = Object.freeze({
  PROJECTS_BY_CUSTOMER: 'projects_by_customer',
  PRODUCTION_BY_CUSTOMER: 'production_by_customer',
  QUOTATIONS_WITHOUT_FOLLOW_UP: 'quotations_without_follow_up',
  DEPOSITS_WITHOUT_WORK_ORDER: 'deposits_without_work_order',
  PROJECTS_BLOCKED_BY_PURCHASES: 'projects_blocked_by_purchases'
});

const ADMIN_ROLES = new Set(['admin', 'owner']);
const EXECUTIVE_ROLES = new Set(['sales', 'ventas', 'executive', 'ejecutivo']);
const ACTIVE_QUOTATION_STATUSES = new Set(['draft', 'quoted', 'sent', 'viewed', 'approved', 'awaiting_deposit']);
const ACTIVE_PROJECT_STATUSES = new Set(['active', 'design', 'work_order_ready', 'production', 'installation']);

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
  if ((text.includes('bloqueado') || text.includes('detenido') || text.includes('parado')) &&
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

function queryParam(name, value) {
  return value ? `&${name}=eq.${encodeURIComponent(value)}` : '';
}

function format(command, rows, customerQuery = '') {
  const customer = customerQuery ? ` de ${customerQuery}` : '';
  if (!rows.length) {
    const empty = {
      [COMMANDS.PRODUCTION_BY_CUSTOMER]: `No encontré trabajos${customer} en producción.`,
      [COMMANDS.PROJECTS_BY_CUSTOMER]: `No encontré proyectos${customer}.`,
      [COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP]: 'No encontré cotizaciones activas sin seguimiento.',
      [COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER]: 'No encontré anticipos confirmados pendientes de Orden de Trabajo.',
      [COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES]: 'No encontré proyectos bloqueados por compras.'
    };
    return empty[command] || 'No encontré resultados.';
  }

  const headers = {
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
    const rows = await executeQuery({ command, customerQuery, scope, reader: resolvedReader });
    return {
      handled: true,
      command,
      outputText: format(command, rows, customerQuery),
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
  format,
  processQuoteRuntimeCommand,
  resolveIntent,
  resolveScope
};
