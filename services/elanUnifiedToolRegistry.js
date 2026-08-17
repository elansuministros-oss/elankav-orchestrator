'use strict';

const connect = require('./ownerBusinessConnectClient');

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'buscar_precio_autorizado',
    description: 'Busca exclusivamente el precio comercial autorizado y publicado de ELANVISUAL usando el resolver oficial de CONNECT. Nunca estima ni inventa precios.',
    scope: 'price.authorized.read',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Producto o servicio a buscar.' },
        width: { type: 'number', description: 'Ancho real, cuando aplique.' },
        height: { type: 'number', description: 'Alto real, cuando aplique.' },
        quantity: { type: 'number', description: 'Cantidad. Por defecto 1.' }
      },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'buscar_cliente',
    description: 'Busca clientes en el directorio oficial de CONNECT.',
    scope: 'customer.read',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string', description: 'Nombre, empresa, teléfono u otro término del cliente.' } },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'buscar_cotizacion',
    description: 'Consulta cotizaciones oficiales almacenadas en CONNECT. Puede recibir projectId; sin projectId lista las cotizaciones recientes.',
    scope: 'quotation.read',
    parameters: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      additionalProperties: false
    }
  },
  {
    name: 'crear_cotizacion',
    description: 'Crea una cotización oficial en CONNECT. Solo Owner.',
    ownerOnly: true,
    parameters: {
      type: 'object',
      properties: {
        document: { type: 'object', description: 'Documento VQS oficial de la cotización.' },
        idempotencyKey: { type: 'string' }
      },
      required: ['document'],
      additionalProperties: false
    }
  },
  {
    name: 'editar_cotizacion',
    description: 'Actualiza una cotización oficial existente en CONNECT. Solo Owner.',
    ownerOnly: true,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        document: { type: 'object' }
      },
      required: ['projectId', 'document'],
      additionalProperties: false
    }
  },
  {
    name: 'buscar_orden_trabajo',
    description: 'Lista las órdenes de trabajo oficiales relacionadas con una cotización/proyecto en CONNECT.',
    scope: 'work_order.read',
    parameters: {
      type: 'object',
      properties: { projectId: { type: 'string' } },
      required: ['projectId'],
      additionalProperties: false
    }
  },
  {
    name: 'buscar_proveedor',
    description: 'Busca proveedores oficiales activos mediante CONNECT.',
    scope: 'provider.read',
    parameters: {
      type: 'object',
      properties: { query: { type: 'string' } },
      required: ['query'],
      additionalProperties: false
    }
  },
  {
    name: 'enviar_whatsapp_cliente',
    description: 'Envía por la ruta oficial de CONNECT una cotización al WhatsApp del cliente. Solo Owner. No confirma envío si CONNECT no lo confirma.',
    ownerOnly: true,
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        body: { type: 'object' }
      },
      required: ['projectId'],
      additionalProperties: false
    }
  },
  {
    name: 'consultar_pago',
    description: 'Consulta pagos oficiales de una cotización/proyecto en CONNECT.',
    scope: 'payment.read',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        paymentId: { type: 'string' }
      },
      required: ['projectId'],
      additionalProperties: false
    }
  }
]);

function scopesOf(actor = {}) {
  return Array.isArray(actor.scopes) ? actor.scopes.map(value => String(value)) : [];
}

function isOwner(actor = {}) {
  return String(actor.role || '').toLowerCase() === 'owner' || String(actor.authority || '').toLowerCase() === 'owner_identity';
}

function isAllowed(definition, actor = {}) {
  if (definition.ownerOnly) return isOwner(actor);
  const scopes = scopesOf(actor);
  return isOwner(actor) || scopes.includes('*') || !definition.scope || scopes.includes(definition.scope);
}

function getToolManifest(actor = {}) {
  return TOOL_DEFINITIONS
    .filter(definition => isAllowed(definition, actor))
    .map(definition => ({
      type: 'function',
      name: definition.name,
      description: definition.description,
      parameters: definition.parameters
    }));
}

function requiredText(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) {
    const error = new Error(`Falta ${field}.`);
    error.code = 'ELAN_TOOL_ARGUMENT_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  return normalized;
}

async function executeTool({ actor = {}, tool, arguments: args = {}, env = process.env } = {}) {
  const name = String(tool || '').trim();
  const definition = TOOL_DEFINITIONS.find(candidate => candidate.name === name);
  if (!definition) {
    const error = new Error(`La herramienta ${name || '(vacía)'} todavía no está disponible en ELAN Runtime.`);
    error.code = 'ELAN_TOOL_NOT_AVAILABLE';
    error.statusCode = 404;
    throw error;
  }
  if (!isAllowed(definition, actor)) {
    const error = new Error('El actor no tiene permiso para ejecutar esta herramienta.');
    error.code = 'ELAN_TOOL_FORBIDDEN';
    error.statusCode = 403;
    throw error;
  }

  switch (name) {
    case 'buscar_precio_autorizado': {
      const query = requiredText(args.query, 'query');
      const input = { query, quantity: Number(args.quantity) > 0 ? Number(args.quantity) : 1 };
      if (Number(args.width) > 0) input.width = Number(args.width);
      if (Number(args.height) > 0) input.height = Number(args.height);
      return connect.resolveCatalogPricing(input, env);
    }
    case 'buscar_cliente':
      return connect.searchCustomers(requiredText(args.query, 'query'), env);
    case 'buscar_cotizacion':
      return args.projectId ? connect.getQuotation(requiredText(args.projectId, 'projectId'), env) : connect.listQuotations(env);
    case 'crear_cotizacion':
      if (!args.document || typeof args.document !== 'object') return Promise.reject(Object.assign(new Error('Falta document.'), { code: 'ELAN_TOOL_ARGUMENT_REQUIRED', statusCode: 400 }));
      return connect.createQuotation(args.document, args.idempotencyKey, env);
    case 'editar_cotizacion':
      return connect.updateQuotation(requiredText(args.projectId, 'projectId'), args.document || {}, env);
    case 'buscar_orden_trabajo':
      return connect.listWorkOrders(requiredText(args.projectId, 'projectId'), env);
    case 'buscar_proveedor':
      return connect.searchProviders(requiredText(args.query, 'query'), env);
    case 'enviar_whatsapp_cliente':
      return connect.sendQuotationWhatsApp(requiredText(args.projectId, 'projectId'), args.body || {}, env);
    case 'consultar_pago': {
      const projectId = requiredText(args.projectId, 'projectId');
      return args.paymentId ? connect.getPayment(projectId, requiredText(args.paymentId, 'paymentId'), env) : connect.listPayments(projectId, env);
    }
    default:
      throw Object.assign(new Error('Herramienta no implementada.'), { code: 'ELAN_TOOL_NOT_AVAILABLE', statusCode: 404 });
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool,
  getToolManifest,
  isAllowed,
  isOwner
};
