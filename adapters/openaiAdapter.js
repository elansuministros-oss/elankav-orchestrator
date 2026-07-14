const OpenAI = require('openai');
const openaiConfig = require('../config/openai.json');

let client = null;

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    const error = new Error('OPENAI_API_KEY no está configurada');
    error.code = 'OPENAI_NOT_CONFIGURED';
    throw error;
  }

  if (!client) {
    client = new OpenAI({
      apiKey,
      timeout: openaiConfig.timeoutMs,
      maxRetries: openaiConfig.maxRetries
    });
  }

  return client;
}

function normalizeResponseInput(input) {
  if (typeof input === 'string' && input.trim()) {
    return input.trim();
  }

  if (Array.isArray(input)) {
    const normalized = input
      .map(message => ({
        role: String(message?.role || '').trim().toLowerCase(),
        content: String(message?.content || '').trim()
      }))
      .filter(message =>
        ['user', 'assistant'].includes(message.role) &&
        message.content
      );

    if (normalized.length) return normalized;
  }

  const error = new TypeError('input debe ser texto o historial válido');
  error.code = 'OPENAI_INVALID_INPUT';
  throw error;
}

async function createResponse({
  input,
  instructions,
  model = process.env.OPENAI_MODEL || openaiConfig.model,
  reasoningEffort = openaiConfig.reasoningEffort
}) {
  const request = {
    model,
    input: normalizeResponseInput(input)
  };

  if (typeof instructions === 'string' && instructions.trim()) {
    request.instructions = instructions.trim();
  }

  if (reasoningEffort) {
    request.reasoning = {
      effort: reasoningEffort
    };
  }

  const response = await getOpenAIClient().responses.create(request);

  return {
    id: response.id,
    model: response.model || model,
    status: response.status || 'completed',
    outputText: response.output_text || '',
    usage: response.usage || null
  };
}

function getOpenAIConfigurationStatus() {
  return {
    configured: Boolean(process.env.OPENAI_API_KEY),
    provider: openaiConfig.provider,
    api: openaiConfig.api,
    model: process.env.OPENAI_MODEL || openaiConfig.model
  };
}

module.exports = {
  createResponse,
  getOpenAIConfigurationStatus,
  normalizeResponseInput
};
