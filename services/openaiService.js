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

  if (context.crm) {
    if (context.crm.available) {
      lines.push('CRM Core conectado y disponible para consultas. Las escrituras se ejecutan únicamente mediante comandos CRM autorizados.');
      lines.push(`CRM identidades=${context.crm.counts?.identities ?? 0}.`);
      lines.push(`CRM conversaciones=${context.crm.counts?.conversations ?? 0}.`);
      lines.push(`CRM mensajes=${context.crm.counts?.messages ?? 0}.`);

      const identities = Array.isArray(context.crm.recentIdentities)
        ? context.crm.recentIdentities
        : [];

      if (identities.length) {
        lines.push(
          `Identidades recientes verificadas: ${JSON.stringify(identities)}.`
        );
      }
    } else {
      lines.push('CRM Core no está disponible en esta solicitud.');
    }
  }

  if (context.ecosystem) {
    if (context.ecosystem.available) {
      lines.push('ELANKAV Orchestrator está conectado como fuente operativa verificada del ecosistema.');
      lines.push(`Estado general=${context.ecosystem.status || 'DESCONOCIDO'}; saludable=${context.ecosystem.healthy === true}; alertas=${context.ecosystem.alerts ?? 'desconocido'}.`);
      lines.push(`GitHub autenticado=${context.ecosystem.githubAuthenticated === true}.`);

      const services = Array.isArray(context.ecosystem.services)
        ? context.ecosystem.services
        : [];
      const repositories = Array.isArray(context.ecosystem.repositories)
        ? context.ecosystem.repositories
        : [];
      const containers = Array.isArray(context.ecosystem.containers)
        ? context.ecosystem.containers
        : [];

      if (services.length) {
        lines.push(`Servicios verificados: ${JSON.stringify(services)}.`);
      }

      if (repositories.length) {
        lines.push(`Repositorios GitHub verificados: ${JSON.stringify(repositories)}.`);
      }

      if (containers.length) {
        lines.push(`Contenedores verificados: ${JSON.stringify(containers)}.`);
      }

      lines.push('No afirmes que GitHub, Docker, WAHA, el Orchestrator o los servicios listados no están conectados cuando el contexto verificado indique lo contrario.');
      lines.push('Distinguí entre una capacidad inexistente y una capacidad existente que todavía no fue expuesta a este contexto.');
    } else {
      lines.push('El contexto operativo del Orchestrator no estuvo disponible en esta solicitud; no infieras que el ecosistema está desconectado.');
    }
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
  buildContextInstructions,
  generateText
};
