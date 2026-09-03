'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const DEFAULT_BASE_URL = 'http://127.0.0.1:7860';
const DEFAULT_ENV_PATH = '/var/lib/elankav-langflow/langflow.env';
const DEFAULT_STATE_PATH = '/var/lib/elankav/orchestrator/langflow-planner.json';
const PLANNER_ENDPOINT = 'elan-semantic-planner';
const PLANNER_VERSION = '1.0.0';
const PLANNER_MODEL = 'gpt-5.6-sol';

const PLANNER_SYSTEM_PROMPT = [
  'Sos ELAN Semantic Planner. Tu única función es elegir una herramienta autorizada; nunca ejecutes acciones.',
  'Recibís un JSON con user_message, context, history y allowed_tools.',
  'Elegí como máximo UNA herramienta de allowed_tools. No inventes nombres de herramientas, IDs, clientes, proveedores, precios ni parámetros.',
  'Para preguntas de materiales, insumos, inventario o catálogo usá una herramienta de catálogo/materiales si está disponible.',
  'Para buscar personas/empresas/proveedores usá la herramienta de directorio correspondiente.',
  'Si faltan datos esenciales o ninguna herramienta aplica, devolvé tool=null.',
  'No conviertas una consulta informativa en una mutación, envío, eliminación, aprobación o compra.',
  'Respondé SOLAMENTE JSON válido, sin markdown ni texto adicional, con esta forma:',
  '{"tool":"nombre_o_null","arguments":{},"confidence":0.0,"reason":"frase breve"}'
].join('\n');

function text(value) {
  return String(value ?? '').trim();
}

function parseEnv(content) {
  const result = {};
  for (const rawLine of String(content || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const index = line.indexOf('=');
    if (index <= 0) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function normalizeHistory(history) {
  return (Array.isArray(history) ? history : [])
    .slice(-12)
    .map(entry => ({
      role: text(entry?.role || entry?.direction || 'unknown').toLowerCase(),
      content: text(entry?.content || entry?.text || '').slice(0, 2000)
    }))
    .filter(entry => entry.content);
}

function extractMessageText(payload) {
  const seen = new Set();
  function visit(value) {
    if (!value || typeof value !== 'object') return null;
    if (seen.has(value)) return null;
    seen.add(value);

    if (value.message && typeof value.message === 'object' && typeof value.message.text === 'string') {
      return value.message.text;
    }
    if (typeof value.text === 'string' && text(value.text)) return value.text;

    if (Array.isArray(value)) {
      for (const entry of value) {
        const found = visit(entry);
        if (found) return found;
      }
      return null;
    }

    for (const entry of Object.values(value)) {
      const found = visit(entry);
      if (found) return found;
    }
    return null;
  }
  return visit(payload);
}

function parsePlannerJson(raw) {
  const source = text(raw);
  if (!source) throw Object.assign(new Error('Langflow no devolvió un plan.'), { code: 'LANGFLOW_PLANNER_EMPTY' });
  const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = text(fenced?.[1] || source);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start < 0 || end <= start) {
      throw Object.assign(new Error('Langflow devolvió un plan no JSON.'), { code: 'LANGFLOW_PLANNER_INVALID_JSON' });
    }
    parsed = JSON.parse(candidate.slice(start, end + 1));
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw Object.assign(new Error('Langflow devolvió un plan inválido.'), { code: 'LANGFLOW_PLANNER_INVALID' });
  }
  return parsed;
}

function validatePlan(plan, allowedTools) {
  const names = new Set((Array.isArray(allowedTools) ? allowedTools : []).map(tool => text(tool?.name)).filter(Boolean));
  const tool = plan.tool === null || plan.tool === undefined || text(plan.tool).toLowerCase() === 'null'
    ? null
    : text(plan.tool);
  if (tool && !names.has(tool)) {
    throw Object.assign(new Error('Langflow seleccionó una herramienta fuera del manifiesto autorizado.'), {
      code: 'LANGFLOW_PLANNER_TOOL_NOT_ALLOWED'
    });
  }
  const args = plan.arguments && typeof plan.arguments === 'object' && !Array.isArray(plan.arguments)
    ? plan.arguments
    : {};
  const numericConfidence = Number(plan.confidence);
  const confidence = Number.isFinite(numericConfidence)
    ? Math.max(0, Math.min(1, numericConfidence))
    : 0;
  return {
    tool,
    arguments: args,
    confidence,
    reason: text(plan.reason).slice(0, 500)
  };
}

function flowCollection(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.flows)) return payload.flows;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildPlannerFlow(example) {
  const payload = clone(example);
  const graph = clone(payload.data || {});
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];

  const promptNode = nodes.find(node => node?.data?.type === 'Prompt');
  const modelNode = nodes.find(node => node?.data?.type === 'LanguageModelComponent');
  const chatInput = nodes.find(node => node?.data?.type === 'ChatInput');
  const chatOutput = nodes.find(node => node?.data?.type === 'ChatOutput');

  if (!promptNode || !modelNode || !chatInput || !chatOutput) {
    throw Object.assign(new Error('La plantilla Basic Prompting no tiene los componentes esperados.'), {
      code: 'LANGFLOW_PLANNER_TEMPLATE_INVALID'
    });
  }

  if (promptNode.data?.node?.template?.template) {
    promptNode.data.node.template.template.value = PLANNER_SYSTEM_PROMPT;
  }
  if (modelNode.data?.node?.template?.model) {
    modelNode.data.node.template.model.value = [{
      name: PLANNER_MODEL,
      provider: 'OpenAI',
      category: 'OpenAI',
      metadata: {}
    }];
  }
  if (modelNode.data?.node?.template?.temperature) {
    modelNode.data.node.template.temperature.value = 0;
  }
  if (chatInput.data?.node?.template?.should_store_message) {
    chatInput.data.node.template.should_store_message.value = false;
  }
  if (chatOutput.data?.node?.template?.should_store_message) {
    chatOutput.data.node.template.should_store_message.value = false;
  }

  return {
    name: 'ELAN Semantic Planner',
    description: `ELANKAV_ORCHESTRATOR_PLANNER:${PLANNER_VERSION}`,
    data: graph,
    is_component: false,
    webhook: false,
    endpoint_name: PLANNER_ENDPOINT,
    tags: ['elan', 'orchestrator', 'semantic-planner']
  };
}

class LangflowPlannerService {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.fsImpl = options.fsImpl || fs;
    this.baseUrl = text(options.baseUrl || process.env.LANGFLOW_INTERNAL_URL || DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.envPath = options.envPath || process.env.LANGFLOW_RUNTIME_ENV_PATH || DEFAULT_ENV_PATH;
    this.statePath = options.statePath || process.env.LANGFLOW_PLANNER_STATE_PATH || DEFAULT_STATE_PATH;
    this.runtimeState = null;
    this.bootstrapPromise = null;
  }

  async request(urlPath, options = {}) {
    const response = await this.fetchImpl(this.baseUrl + urlPath, {
      ...options,
      signal: options.signal || AbortSignal.timeout(Number(options.timeoutMs || 30_000))
    });
    const raw = await response.text();
    let payload = {};
    if (raw) {
      try { payload = JSON.parse(raw); } catch { payload = { raw }; }
    }
    if (!response.ok) {
      const error = new Error(`Langflow HTTP ${response.status}`);
      error.code = `LANGFLOW_HTTP_${response.status}`;
      error.statusCode = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  }

  async readState() {
    if (this.runtimeState) return this.runtimeState;
    try {
      const raw = await this.fsImpl.readFile(this.statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (text(parsed?.apiKey) && text(parsed?.flowId)) {
        this.runtimeState = parsed;
        return parsed;
      }
    } catch {}
    return null;
  }

  async writeState(state) {
    const dir = path.dirname(this.statePath);
    await this.fsImpl.mkdir(dir, { recursive: true, mode: 0o700 });
    const temp = `${this.statePath}.${process.pid}.tmp`;
    await this.fsImpl.writeFile(temp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await this.fsImpl.rename(temp, this.statePath);
    this.runtimeState = state;
  }

  async readBootstrapCredentials() {
    const raw = await this.fsImpl.readFile(this.envPath, 'utf8');
    const env = parseEnv(raw);
    const username = text(env.LANGFLOW_SUPERUSER);
    const password = text(env.LANGFLOW_SUPERUSER_PASSWORD);
    if (!username || !password) {
      throw Object.assign(new Error('No están disponibles las credenciales locales de bootstrap de Langflow.'), {
        code: 'LANGFLOW_BOOTSTRAP_CREDENTIALS_MISSING'
      });
    }
    return { username, password };
  }

  async login() {
    const credentials = await this.readBootstrapCredentials();
    const body = new URLSearchParams(credentials).toString();
    const payload = await this.request('/api/v1/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
      timeoutMs: 30_000
    });
    const token = text(payload?.access_token);
    if (!token) throw Object.assign(new Error('Langflow no devolvió token de sesión.'), { code: 'LANGFLOW_LOGIN_TOKEN_MISSING' });
    return token;
  }

  async bearerRequest(token, urlPath, options = {}) {
    return this.request(urlPath, {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {}),
        Authorization: `Bearer ${token}`
      }
    });
  }

  async ensurePlannerFlow(token) {
    const current = flowCollection(await this.bearerRequest(token, '/api/v1/flows/'));
    const existing = current.find(flow => text(flow?.endpoint_name) === PLANNER_ENDPOINT || text(flow?.name) === 'ELAN Semantic Planner');
    if (existing?.id) {
      return { flowId: text(existing.id), endpointName: text(existing.endpoint_name || PLANNER_ENDPOINT) };
    }

    const examples = flowCollection(await this.bearerRequest(token, '/api/v1/flows/basic_examples/'));
    const basic = examples.find(flow => text(flow?.name_key).toLowerCase() === 'basic_prompting' || text(flow?.name).toLowerCase() === 'basic prompting');
    if (!basic) {
      throw Object.assign(new Error('No se encontró la plantilla Basic Prompting en Langflow.'), {
        code: 'LANGFLOW_BASIC_TEMPLATE_NOT_FOUND'
      });
    }

    const created = await this.bearerRequest(token, '/api/v1/flows/', {
      method: 'POST',
      body: JSON.stringify(buildPlannerFlow(basic)),
      timeoutMs: 60_000
    });
    const flowId = text(created?.id);
    if (!flowId) throw Object.assign(new Error('Langflow no devolvió el ID del planner.'), { code: 'LANGFLOW_PLANNER_FLOW_ID_MISSING' });
    return { flowId, endpointName: text(created?.endpoint_name || PLANNER_ENDPOINT) };
  }

  async createRuntimeApiKey(token) {
    const payload = await this.bearerRequest(token, '/api/v1/api_key/', {
      method: 'POST',
      body: JSON.stringify({ name: 'elankav-orchestrator-runtime' }),
      timeoutMs: 30_000
    });
    const apiKey = text(payload?.api_key);
    if (!apiKey) throw Object.assign(new Error('Langflow no devolvió API key de runtime.'), { code: 'LANGFLOW_RUNTIME_KEY_MISSING' });
    return apiKey;
  }

  async bootstrap() {
    const existing = await this.readState();
    if (existing) return existing;
    if (this.bootstrapPromise) return this.bootstrapPromise;

    this.bootstrapPromise = (async () => {
      const token = await this.login();
      const flow = await this.ensurePlannerFlow(token);
      const apiKey = await this.createRuntimeApiKey(token);
      const state = {
        version: PLANNER_VERSION,
        flowId: flow.flowId,
        endpointName: flow.endpointName,
        apiKey,
        createdAt: new Date().toISOString()
      };
      await this.writeState(state);
      return state;
    })();

    try {
      return await this.bootstrapPromise;
    } finally {
      this.bootstrapPromise = null;
    }
  }

  async runWithState(state, inputValue, sessionId) {
    return this.request(`/api/v1/run/${encodeURIComponent(state.flowId)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'x-api-key': state.apiKey
      },
      body: JSON.stringify({
        input_value: inputValue,
        session_id: sessionId,
        input_type: 'chat',
        output_type: 'chat',
        output_component: ''
      }),
      timeoutMs: 60_000
    });
  }

  async plan({ message, actor = {}, platform = 'ELANVISUAL', channel = 'unknown', history = [], allowedTools = [] } = {}) {
    if (!text(message)) return { available: true, plan: { tool: null, arguments: {}, confidence: 0, reason: 'empty_message' } };
    if (!Array.isArray(allowedTools) || allowedTools.length === 0) {
      return { available: true, plan: { tool: null, arguments: {}, confidence: 0, reason: 'no_allowed_tools' } };
    }

    let state;
    try {
      state = await this.bootstrap();
    } catch (error) {
      return { available: false, errorCode: error?.code || 'LANGFLOW_BOOTSTRAP_FAILED' };
    }

    const inputValue = JSON.stringify({
      user_message: text(message),
      context: {
        platform: text(platform).toUpperCase() || 'ELANVISUAL',
        channel: text(channel).toLowerCase() || 'unknown',
        actor_role: text(actor?.role).toLowerCase() || 'unknown'
      },
      history: normalizeHistory(history),
      allowed_tools: allowedTools.map(tool => ({
        name: text(tool?.name),
        description: text(tool?.description),
        parameters: tool?.parameters && typeof tool.parameters === 'object' ? tool.parameters : {}
      }))
    });

    const sessionId = [
      'elan-planner',
      text(platform).toUpperCase() || 'ELANVISUAL',
      text(actor?.actorId || actor?.canonicalPhone || actor?.phone || 'anonymous')
    ].join(':').slice(0, 240);

    try {
      let payload;
      try {
        payload = await this.runWithState(state, inputValue, sessionId);
      } catch (error) {
        if (error?.statusCode !== 401) throw error;
        this.runtimeState = null;
        await this.fsImpl.unlink(this.statePath).catch(() => {});
        state = await this.bootstrap();
        payload = await this.runWithState(state, inputValue, sessionId);
      }
      const output = extractMessageText(payload);
      const parsed = parsePlannerJson(output);
      return { available: true, plan: validatePlan(parsed, allowedTools), flowId: state.flowId };
    } catch (error) {
      return { available: false, errorCode: error?.code || 'LANGFLOW_PLANNER_FAILED' };
    }
  }

  async status() {
    try {
      const health = await this.request('/health_check', { timeoutMs: 5_000 });
      const state = await this.readState();
      return {
        available: true,
        health,
        configured: Boolean(state?.flowId && state?.apiKey),
        flowId: state?.flowId || null,
        version: PLANNER_VERSION
      };
    } catch (error) {
      return {
        available: false,
        configured: false,
        flowId: null,
        version: PLANNER_VERSION,
        errorCode: error?.code || 'LANGFLOW_UNAVAILABLE'
      };
    }
  }
}

const langflowPlannerService = new LangflowPlannerService();

module.exports = {
  DEFAULT_BASE_URL,
  DEFAULT_ENV_PATH,
  DEFAULT_STATE_PATH,
  PLANNER_ENDPOINT,
  PLANNER_MODEL,
  PLANNER_SYSTEM_PROMPT,
  PLANNER_VERSION,
  LangflowPlannerService,
  buildPlannerFlow,
  extractMessageText,
  langflowPlannerService,
  normalizeHistory,
  parseEnv,
  parsePlannerJson,
  validatePlan
};
