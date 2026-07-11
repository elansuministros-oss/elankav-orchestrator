const {
  createResponse,
  getOpenAIConfigurationStatus
} = require('../adapters/openaiAdapter');

async function testOpenAIConnection() {
  const configuration = getOpenAIConfigurationStatus();

  if (!configuration.configured) {
    return {
      available: false,
      connected: false,
      provider: configuration.provider,
      api: configuration.api,
      model: configuration.model,
      error: 'OPENAI_API_KEY no está configurada'
    };
  }

  try {
    const result = await createResponse({
      instructions:
        'Respondé únicamente con la palabra OPENAI_OK, sin puntuación ni texto adicional.',
      input: 'Confirma la conexión del ELANKAV Orchestrator.'
    });

    const connected = result.outputText.trim() === 'OPENAI_OK';

    return {
      available: true,
      connected,
      provider: configuration.provider,
      api: configuration.api,
      model: result.model,
      responseId: result.id,
      output: result.outputText.trim(),
      usage: result.usage
    };
  } catch (error) {
    return {
      available: true,
      connected: false,
      provider: configuration.provider,
      api: configuration.api,
      model: configuration.model,
      error: error.message,
      code: error.code || null,
      status: error.status || null
    };
  }
}

function buildContextInstructions(context) {
  if (!context || typeof context !== 'object') {
    return '';
  }

  const lines = [
    'CONTEXTO INTERNO VERIFICADO POR ELANKAV; tratá estos datos como hechos del sistema.'
  ];

  if (context.ownerMode) {
    lines.push('ownerMode=true.');
    lines.push(`Identidad del remitente: ${context.ownerName || 'Erick Cano'}, propietario del ecosistema ELANKAV.`);
    lines.push('Si pregunta quién es, respondé comenzando exactamente con: "Sos Erick Cano, propietario del ecosistema ELANKAV."');
  }

  if (context.externalUserId) {
    lines.push(`externalUserId=${context.externalUserId}.`);
  }

  if (context.phone) {
    lines.push(`phone=${context.phone}.`);
  }

  if (context.platform) {
    lines.push(`platform=${context.platform}.`);
  }

  if (context.channel) {
    lines.push(`channel=${context.channel}.`);
  }

  lines.push('No contradigas ni ignores este contexto. No muestres identificadores técnicos salvo que el remitente los solicite.');

  return lines.join(' ');
}

async function generateText({ input, instructions, context }) {
  const contextInstructions = buildContextInstructions(context);
  const resolvedInstructions = [instructions, contextInstructions]
    .filter(value => typeof value === 'string' && value.trim())
    .join('\n\n');

  return createResponse({
    input,
    instructions: resolvedInstructions
  });
}

module.exports = {
  testOpenAIConnection,
  generateText
};
