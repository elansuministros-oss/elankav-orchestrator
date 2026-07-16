import { summarizeOperationalQuery } from '../../services/quoteCore/projectQueryService.js';

export const QUOTE_AI_COMMANDS = Object.freeze({
  PROJECTS_BY_CUSTOMER: 'projects_by_customer',
  PRODUCTION_BY_CUSTOMER: 'production_by_customer',
  QUOTATIONS_WITHOUT_FOLLOW_UP: 'quotations_without_follow_up',
  DEPOSITS_WITHOUT_WORK_ORDER: 'deposits_without_work_order',
  PROJECTS_BLOCKED_BY_PURCHASES: 'projects_blocked_by_purchases'
});

const ADMIN_ROLES = new Set(['admin', 'owner']);
const EXECUTIVE_ROLES = new Set(['sales', 'ventas', 'executive', 'ejecutivo']);

const normalize = (value = '') => String(value)
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toLowerCase();

function resolveRoleScope(actor = {}) {
  const role = normalize(actor.role);
  if (ADMIN_ROLES.has(role)) return { role, executiveId: '' };
  if (EXECUTIVE_ROLES.has(role)) {
    if (!actor.executiveId) throw new Error('El ejecutivo requiere executiveId para consultar su propio panel');
    return { role, executiveId: actor.executiveId };
  }
  throw new Error('Rol no autorizado para consultas operativas de cotizaciones');
}

export function resolveQuoteCommandIntent(message = '') {
  const text = normalize(message);

  if (!text) return null;

  if ((text.includes('produccion') || text.includes('en produccion')) &&
      (text.includes('cliente') || text.includes('de ') || text.includes('trabajo'))) {
    return QUOTE_AI_COMMANDS.PRODUCTION_BY_CUSTOMER;
  }

  if (text.includes('sin seguimiento') || text.includes('no tienen seguimiento') || text.includes('seguimiento pendiente')) {
    return QUOTE_AI_COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP;
  }

  if ((text.includes('anticipo') || text.includes('deposito')) &&
      (text.includes('sin ot') || text.includes('sin orden de trabajo') || text.includes('no tienen orden de trabajo'))) {
    return QUOTE_AI_COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER;
  }

  if ((text.includes('bloqueado') || text.includes('detenido') || text.includes('parado')) &&
      (text.includes('compra') || text.includes('proveedor') || text.includes('material'))) {
    return QUOTE_AI_COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES;
  }

  if (text.includes('proyectos de') || text.includes('trabajos de') || text.includes('cotizaciones de')) {
    return QUOTE_AI_COMMANDS.PROJECTS_BY_CUSTOMER;
  }

  return null;
}

export function extractCustomerQuery(message = '') {
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

export class ElanAiQuoteCommandModule {
  constructor({ projectQueryService } = {}) {
    if (!projectQueryService) throw new Error('ElanAiQuoteCommandModule requiere ProjectQueryService');
    this.projectQueryService = projectQueryService;
  }

  async execute({ command, message = '', params = {}, actor = {} } = {}) {
    const resolvedCommand = command || resolveQuoteCommandIntent(message);
    if (!resolvedCommand) {
      return {
        handled: false,
        command: null,
        response: 'No pude identificar una consulta operativa de cotizaciones o proyectos.'
      };
    }

    const scope = resolveRoleScope(actor);
    const executiveId = scope.executiveId || params.executiveId || '';
    const customerQuery = params.customerQuery || extractCustomerQuery(message);
    let rows = [];

    switch (resolvedCommand) {
      case QUOTE_AI_COMMANDS.PROJECTS_BY_CUSTOMER:
        rows = await this.projectQueryService.getProjectsByCustomer({
          customerQuery,
          status: params.status,
          executiveId,
          limit: params.limit
        });
        break;

      case QUOTE_AI_COMMANDS.PRODUCTION_BY_CUSTOMER:
        rows = await this.projectQueryService.getProductionProjects({
          customerQuery,
          executiveId,
          limit: params.limit
        });
        break;

      case QUOTE_AI_COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP:
        rows = await this.projectQueryService.getQuotationsWithoutFollowUp({
          executiveId,
          staleDays: params.staleDays,
          limit: params.limit
        });
        break;

      case QUOTE_AI_COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER:
        rows = await this.projectQueryService.getDepositsWithoutWorkOrder({
          executiveId,
          limit: params.limit
        });
        break;

      case QUOTE_AI_COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES:
        if (!ADMIN_ROLES.has(scope.role)) {
          throw new Error('Solo administración puede consultar bloqueos internos de compras');
        }
        rows = await this.projectQueryService.getProjectsBlockedByPurchases({
          executiveId: params.executiveId || '',
          limit: params.limit
        });
        break;

      default:
        return { handled: false, command: resolvedCommand, response: 'Comando no soportado.' };
    }

    const result = summarizeOperationalQuery(resolvedCommand, rows);
    return {
      handled: true,
      command: resolvedCommand,
      scope: ADMIN_ROLES.has(scope.role) ? 'global' : 'own',
      result,
      response: formatQuoteCommandResponse(result, { customerQuery })
    };
  }
}

export function formatQuoteCommandResponse(result, context = {}) {
  const rows = result?.rows || [];
  const customer = context.customerQuery ? ` de ${context.customerQuery}` : '';

  if (!rows.length) {
    const emptyMessages = {
      [QUOTE_AI_COMMANDS.PRODUCTION_BY_CUSTOMER]: `No encontré trabajos${customer} en producción.`,
      [QUOTE_AI_COMMANDS.PROJECTS_BY_CUSTOMER]: `No encontré proyectos${customer}.`,
      [QUOTE_AI_COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP]: 'No encontré cotizaciones activas sin seguimiento.',
      [QUOTE_AI_COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER]: 'No encontré anticipos confirmados pendientes de Orden de Trabajo.',
      [QUOTE_AI_COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES]: 'No encontré proyectos bloqueados por compras.'
    };
    return emptyMessages[result.type] || 'No encontré resultados.';
  }

  const headers = {
    [QUOTE_AI_COMMANDS.PRODUCTION_BY_CUSTOMER]: `${rows.length} trabajo(s)${customer} en producción:`,
    [QUOTE_AI_COMMANDS.PROJECTS_BY_CUSTOMER]: `${rows.length} proyecto(s)${customer}:`,
    [QUOTE_AI_COMMANDS.QUOTATIONS_WITHOUT_FOLLOW_UP]: `${rows.length} cotización(es) requieren seguimiento:`,
    [QUOTE_AI_COMMANDS.DEPOSITS_WITHOUT_WORK_ORDER]: `${rows.length} proyecto(s) tienen anticipo confirmado y aún no tienen OT:`,
    [QUOTE_AI_COMMANDS.PROJECTS_BLOCKED_BY_PURCHASES]: `${rows.length} proyecto(s) están bloqueados por compras:`
  };

  const lines = rows.map((row, index) => {
    const number = row.projectNumber || row.quotationNumber || row.project?.projectNumber || `Registro ${index + 1}`;
    const title = row.title || row.project?.title || row.customerCompanyName || row.customerName || '';
    const state = row.currentStage || row.status || row.project?.currentStage || '';
    return `${index + 1}. ${number}${title ? ` — ${title}` : ''}${state ? ` · ${state}` : ''}`;
  });

  return [headers[result.type] || `${rows.length} resultado(s):`, ...lines].join('\n');
}
