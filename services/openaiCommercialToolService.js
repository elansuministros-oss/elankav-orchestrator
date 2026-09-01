'use strict';

const { createToolResponse } = require('../adapters/openaiAdapter');
const {
  ConnectMarketplaceToolError,
  createConnectMarketplaceToolAdapter
} = require('../adapters/connectMarketplaceToolAdapter');

const MAX_TOOL_ROUNDS = 3;

const ELAN_COMMERCIAL_TOOLS = Object.freeze([
  Object.freeze({
    type: 'function',
    name: 'get_contact_capabilities',
    description: 'Consulta qué canales comerciales puede ejecutar ELAN realmente en este momento. No envía mensajes ni modifica estado.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false
    },
    strict: true
  }),
  Object.freeze({
    type: 'function',
    name: 'execute_contact_next',
    description: 'Ejecuta únicamente la próxima acción comercial ya autorizada para un caso de Contact Resolver. CONNECT aplica horarios, bloqueos, límites, respuesta previa y capacidad real del canal.',
    parameters: {
      type: 'object',
      properties: {
        case_code: {
          type: 'string',
          minLength: 1,
          description: 'Código exacto del caso Contact Resolver, por ejemplo CONTACT-ABC123.'
        }
      },
      required: ['case_code'],
      additionalProperties: false
    },
    strict: true
  })
]);

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

async function executeCommercialTool(call, adapter) {
  const name = String(call?.name || '').trim();
  const args = safeJsonParse(call?.arguments);

  try {
    if (name === 'get_contact_capabilities') {
      return {
        ok: true,
        result: await adapter.getContactCapabilities()
      };
    }

    if (name === 'execute_contact_next') {
      const caseCode = String(args.case_code || '').trim();
      if (!caseCode) {
        const error = new Error('case_code es obligatorio.');
        error.code = 'CONTACT_CASE_CODE_REQUIRED';
        throw error;
      }
      return {
        ok: true,
        result: await adapter.executeContactNext(caseCode)
      };
    }

    const error = new Error(`Herramienta no autorizada: ${name || 'sin nombre'}.`);
    error.code = 'ELAN_TOOL_NOT_ALLOWED';
    throw error;
  } catch (error) {
    return toolErrorPayload(error);
  }
}

async function runCommercialToolDecision({
  input,
  instructions,
  adapter = createConnectMarketplaceToolAdapter(),
  createToolResponseImpl = createToolResponse
} = {}) {
  const resolvedInstructions = [
    'Sos el cerebro de decisión comercial de ELAN.',
    'Nunca afirmes que una acción externa ocurrió si la herramienta no devolvió ok=true.',
    'Consultá capacidades cuando necesites saber si un canal está realmente disponible.',
    'Usá execute_contact_next únicamente para un case_code existente; CONNECT decide si debe enviar, esperar, detener o resolver otro canal.',
    'No inventes credenciales, permisos, mensajes enviados, comentarios ni estados de plataforma.',
    'No intentes eludir AUTH_REQUIRED, PLATFORM_UNSUPPORTED, BLOCKED, CAPTCHA, autenticación ni restricciones de plataforma.',
    'Minimizá llamadas: reutilizá el resultado de herramientas dentro de esta ejecución y no repitas una consulta sin necesidad.',
    String(instructions || '').trim()
  ].filter(Boolean).join(' ');

  let response = await createToolResponseImpl({
    input,
    instructions: resolvedInstructions,
    tools: ELAN_COMMERCIAL_TOOLS
  });

  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const calls = Array.isArray(response.output)
      ? response.output.filter(item => item?.type === 'function_call')
      : [];

    if (!calls.length) return response;

    const outputs = [];
    for (const call of calls) {
      const result = await executeCommercialTool(call, adapter);
      outputs.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: JSON.stringify(result)
      });
    }

    response = await createToolResponseImpl({
      input: outputs,
      instructions: resolvedInstructions,
      tools: ELAN_COMMERCIAL_TOOLS,
      previousResponseId: response.id
    });
  }

  const error = new Error('Se alcanzó el máximo de rondas de herramientas comerciales.');
  error.code = 'ELAN_TOOL_ROUNDS_EXHAUSTED';
  throw error;
}

module.exports = {
  ELAN_COMMERCIAL_TOOLS,
  MAX_TOOL_ROUNDS,
  executeCommercialTool,
  runCommercialToolDecision,
  toolErrorPayload
};
