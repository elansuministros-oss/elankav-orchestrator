'use strict';

const { createToolResponse } = require('../adapters/openaiAdapter');
const {
  createConnectChannelToolAdapter
} = require('../adapters/connectChannelToolAdapter');
const {
  createConnectMarketplaceToolAdapter
} = require('../adapters/connectMarketplaceToolAdapter');

const MAX_TOOL_ROUNDS = 3;

const GLOBAL_CHANNEL_TOOL = Object.freeze({
  type: 'function',
  name: 'get_channel_capabilities',
  description: 'Consulta los canales globales que ELANKAV tiene realmente disponibles. No depende de una plataforma específica y no ejecuta acciones.',
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false
  },
  strict: true
});


const COMMERCIAL_BRIEFING_TOOL = Object.freeze({
  type: 'function',
  name: 'get_commercial_briefing',
  description: 'Obtiene el resumen comercial auditable de CONNECT para responder preguntas como qué está pendiente, quién no respondió, qué requiere atención personal o cómo va el negocio. Puede filtrar por fechas, unidad, plataforma, canal, fuente o campaña.',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Fecha/hora ISO inicial, opcional.' },
      to: { type: 'string', description: 'Fecha/hora ISO final, opcional.' },
      business_unit: { type: 'string', description: 'ELANVISUAL, ELANPET, ELAN GO u otra unidad.' },
      platform: { type: 'string', description: 'Plataforma comercial, opcional.' },
      channel: { type: 'string', description: 'whatsapp, email, messenger, instagram_dm, etc.' },
      source: { type: 'string', description: 'Origen comercial, opcional.' },
      campaign: { type: 'string', description: 'Campaña específica, opcional.' }
    },
    required: [],
    additionalProperties: false
  },
  strict: true
});

const MARKETPLACE_CONTACT_TOOL = Object.freeze({
  type: 'function',
  name: 'execute_marketplace_contact_next',
  description: 'Ejecuta únicamente la próxima acción ya autorizada de un caso de Contact Resolver de ELAN GO. CONNECT conserva horarios, bloqueos, límites y seguimiento.',
  parameters: {
    type: 'object',
    properties: {
      case_code: {
        type: 'string',
        minLength: 1,
        description: 'Código exacto del caso Contact Resolver.'
      }
    },
    required: ['case_code'],
    additionalProperties: false
  },
  strict: true
});

function toolsForScope(scope) {
  return scope === 'marketplace'
    ? [GLOBAL_CHANNEL_TOOL, COMMERCIAL_BRIEFING_TOOL, MARKETPLACE_CONTACT_TOOL]
    : [GLOBAL_CHANNEL_TOOL, COMMERCIAL_BRIEFING_TOOL];
}

function safeJsonParse(value) {
  try {
    return JSON.parse(String(value || '{}'));
  } catch {
    return {};
  }
}

function toolErrorPayload(error) {
  return {
    ok: false,
    error: {
      code: String(error?.code || 'ELAN_TOOL_ERROR'),
      message: String(error?.message || 'La herramienta no pudo ejecutarse.'),
      ...(Number.isInteger(error?.status) ? { status: error.status } : {})
    }
  };
}

async function executeChannelTool(
  call,
  {
    channelAdapter,
    marketplaceAdapter
  }
) {
  const name = String(call?.name || '').trim();
  const args = safeJsonParse(call?.arguments);

  try {
    if (name === 'get_channel_capabilities') {
      return {
        ok: true,
        result: await channelAdapter.getChannelCapabilities()
      };
    }

    if (name === 'get_commercial_briefing') {
      return {
        ok: true,
        result: await channelAdapter.getCommercialBriefing({
          from: args.from,
          to: args.to,
          businessUnit: args.business_unit,
          platform: args.platform,
          channel: args.channel,
          source: args.source,
          campaign: args.campaign
        })
      };
    }

    if (name === 'execute_marketplace_contact_next') {
      if (!marketplaceAdapter) {
        const error = new Error('La herramienta de ELAN GO no está habilitada en este contexto.');
        error.code = 'ELAN_TOOL_SCOPE_DENIED';
        throw error;
      }
      const caseCode = String(args.case_code || '').trim();
      if (!caseCode) {
        const error = new Error('case_code es obligatorio.');
        error.code = 'CONTACT_CASE_CODE_REQUIRED';
        throw error;
      }
      return {
        ok: true,
        result: await marketplaceAdapter.executeContactNext(caseCode)
      };
    }

    const error = new Error(`Herramienta no autorizada: ${name || 'sin nombre'}.`);
    error.code = 'ELAN_TOOL_NOT_ALLOWED';
    throw error;
  } catch (error) {
    return toolErrorPayload(error);
  }
}

async function runChannelToolDecision({
  input,
  instructions,
  scope = 'global',
  channelAdapter = createConnectChannelToolAdapter(),
  marketplaceAdapter = scope === 'marketplace'
    ? createConnectMarketplaceToolAdapter()
    : null,
  createToolResponseImpl = createToolResponse
} = {}) {
  const tools = toolsForScope(scope);
  const resolvedInstructions = [
    'Sos el cerebro de decisión de ELAN para herramientas autorizadas del ecosistema ELANKAV.',
    'Las capacidades de canal son globales y no pertenecen a ELAN GO ni a ninguna plataforma particular.',
    'Cuando el usuario pregunte por pendientes, correos o mensajes sin respuesta, seguimiento, clientes que debe atender personalmente, rendimiento diario/semanal o resumen del negocio, usá get_commercial_briefing antes de responder.',
    'Nunca afirmes que una acción externa ocurrió si la herramienta no devolvió ok=true.',
    'No inventes credenciales, permisos, envíos, comentarios ni estados de plataforma.',
    'No intentes eludir AUTH_REQUIRED, PLATFORM_UNSUPPORTED, BLOCKED, CAPTCHA, autenticación ni restricciones de plataforma.',
    scope === 'marketplace'
      ? 'La herramienta execute_marketplace_contact_next existe únicamente porque este contexto pertenece a ELAN GO.'
      : 'No uses ni supongas herramientas específicas de ELAN GO en este contexto.',
    'Minimizá llamadas y reutilizá resultados ya obtenidos.',
    String(instructions || '').trim()
  ].filter(Boolean).join(' ');

  let response = await createToolResponseImpl({
    input,
    instructions: resolvedInstructions,
    tools
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = Array.isArray(response.output)
      ? response.output.filter(item => item?.type === 'function_call')
      : [];

    if (!calls.length) return response;

    const outputs = [];
    for (const call of calls) {
      const result = await executeChannelTool(call, {
        channelAdapter,
        marketplaceAdapter
      });
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }

    response = await createToolResponseImpl({
      input: outputs,
      instructions: resolvedInstructions,
      tools,
      previousResponseId: response.id
    });
  }

  const error = new Error('Se alcanzó el máximo de rondas de herramientas.');
  error.code = 'ELAN_TOOL_ROUNDS_EXHAUSTED';
  throw error;
}

module.exports = {
  GLOBAL_CHANNEL_TOOL,
  COMMERCIAL_BRIEFING_TOOL,
  MARKETPLACE_CONTACT_TOOL,
  MAX_TOOL_ROUNDS,
  executeChannelTool,
  runChannelToolDecision,
  toolsForScope,
  toolErrorPayload
};
