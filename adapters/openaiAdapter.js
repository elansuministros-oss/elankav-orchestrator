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

async function createResponse({
  input,
  instructions,
  model = process.env.OPENAI_MODEL || openaiConfig.model,
  reasoningEffort = openaiConfig.reasoningEffort
}) {
  if (typeof input !== 'string' || !input.trim()) {
    const error = new TypeError('input debe ser un texto no vacío');
    error.code = 'OPENAI_INVALID_INPUT';
    throw error;
  }

  const request = {
    model,
    input: input.trim()
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
  getOpenAIConfigurationStatus
};
